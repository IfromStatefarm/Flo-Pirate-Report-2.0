import { handleCustomerApi } from '../../../server/http.js';

export default {
  fetch(request) {
    return handleCustomerApi('memberships', request);
  }
};
