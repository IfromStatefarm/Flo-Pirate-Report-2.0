import crypto from 'node:crypto';
import { assert } from './api_error.js';
import { reauthorizeActor } from './customer_authorization.js';
import { validateGoogleCommand } from './integrations/google_command_policy.js';

export const integrationRequestHash = command => crypto.createHash('sha256').update(JSON.stringify([command.name, command.args])).digest('hex');
export const uploadOperationKey = (actor, command) => crypto.createHash('sha256')
  .update(JSON.stringify([actor.customerId, actor.memberId, command.requestId, integrationRequestHash(command)])).digest('hex');

export function createIntegrationJournal({ transact, recordUpload }) {
  async function admit(client, actor, command) {
    const current = await reauthorizeActor(client, actor);
    validateGoogleCommand(current, command);
    const stored = (await client.query(`SELECT *, lease_expires_at <= now() AS lease_expired
      FROM integration_operations WHERE customer_id=$1 AND operation_id=$2 FOR UPDATE`, [actor.customerId, command.requestId])).rows[0];
    if (stored) assert(stored.user_id === actor.memberId && stored.request_hash === integrationRequestHash(command),
      409, 'operation_conflict', 'This operation ID has already been used.');
    return { current, stored };
  }

  return {
    async runIntegrationOperation(actor, command, work) {
      const attemptId = crypto.randomUUID();
      const prior = await transact(async client => {
        const { current, stored } = await admit(client, actor, command);
        if (stored?.status === 'completed') return { found: true, result: stored.result };
        if (stored) {
          assert(stored.status === 'retryable' || (stored.status === 'preparing' && stored.lease_expired),
            409, stored.status === 'preparing' ? 'operation_in_progress' : 'operation_uncertain',
            'This operation is in progress or needs reconciliation before retrying.');
          await client.query(`UPDATE integration_operations SET status='preparing',attempt_id=$3,lease_expires_at=now()+interval '2 minutes'
            WHERE customer_id=$1 AND operation_id=$2`, [actor.customerId, command.requestId, attemptId]);
        } else {
          const count = (await client.query("SELECT count(*)::int AS used FROM integration_operations WHERE customer_id=$1 AND created_at>now()-interval '1 hour'", [actor.customerId])).rows[0].used;
          assert(count < 5000, 429, 'rate_limited', 'Customer operation budget exceeded. Try again later.');
          await client.query(`INSERT INTO integration_operations(customer_id,operation_id,user_id,name,request_hash,status,attempt_id,lease_expires_at)
            VALUES($1,$2,$3,$4,$5,'preparing',$6,now()+interval '2 minutes')`,
          [actor.customerId, command.requestId, actor.memberId, command.name, integrationRequestHash(command), attemptId]);
        }
        return { actor: current };
      }, { isolation: 'SERIALIZABLE' });
      if (prior.found) return prior.result;

      let mayHaveWritten = false;
      const transition = async (status, result = null) => transact(async client => {
        const current = await reauthorizeActor(client, actor);
        validateGoogleCommand(current, command);
        const updated = await client.query(`UPDATE integration_operations SET status=$4,result=$5,
          completed_at=CASE WHEN $4='completed' THEN now() ELSE NULL END,
          lease_expires_at=now()+interval '2 minutes'
          WHERE customer_id=$1 AND operation_id=$2 AND attempt_id=$3 AND status IN ('preparing','uncertain')`,
        [actor.customerId, command.requestId, attemptId, status, JSON.stringify(result)]);
        assert(updated.rowCount === 1, 409, 'operation_uncertain', 'This operation attempt no longer owns the receipt.');
      });
      const journal = {
        // Called after all local checks, immediately before each provider write.
        // Return a rejection callback specific to this write; a later rejection
        // must never erase an earlier successful or ambiguous write.
        async beforeWrite() {
          const previouslyWritten = mayHaveWritten;
          await transition('uncertain');
          mayHaveWritten = true;
          return async () => {
            if (!previouslyWritten) {
              await transition('preparing');
              mayHaveWritten = false;
            }
          };
        }
      };
      try {
        const result = await work(prior.actor, journal);
        await transition('completed', result);
        return result;
      } catch (error) {
        // The durable boundary already covers crashes, transport errors, response
        // parsing failures and local persistence failures after a provider write.
        if (!mayHaveWritten) await transition('retryable').catch(() => {});
        throw error;
      }
    },

    async reconcileIntegrationUpload(actor, command, verifyReceipt) {
      assert(command.name === 'uploadToDrive', 400, 'invalid_operation', 'Only evidence uploads support receipt reconciliation.');
      const prior = await transact(async client => {
        const { current, stored } = await admit(client, actor, command);
        assert(stored, 404, 'operation_unavailable', 'The upload receipt is unavailable.');
        assert(['started', 'uncertain', 'completed'].includes(stored.status), 409, 'operation_not_uncertain', 'Retry this upload with its original ID.');
        return { actor: current, stored };
      });
      if (prior.stored.status === 'completed') return prior.stored.result;
      // Read-only provider verification runs outside a database transaction.
      const result = await verifyReceipt(prior.actor, { legacy: !prior.stored.attempt_id });
      return transact(async client => {
        const { current, stored } = await admit(client, actor, command);
        if (stored?.status === 'completed') return stored.result;
        assert(stored && ['started', 'uncertain'].includes(stored.status) && stored.attempt_id === prior.stored.attempt_id,
          409, 'operation_uncertain', 'The upload receipt changed during reconciliation.');
        await recordUpload(client, current, command.args[4], command.args[3], result,
          crypto.createHash('sha256').update(Buffer.from(command.args[2], 'base64')).digest('hex'));
        await client.query(`UPDATE integration_operations SET status='completed',result=$3,completed_at=now()
          WHERE customer_id=$1 AND operation_id=$2`, [actor.customerId, command.requestId, JSON.stringify(result)]);
        return result;
      });
    }
  };
}
