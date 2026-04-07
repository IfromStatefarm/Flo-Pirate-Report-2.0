// search_bot.js

(function() {
  const HOST_ID = "flo-picker-host";

  function injectRobustOverlay() {
    // 1. Check if host already exists
    if (document.getElementById(HOST_ID)) return;

    console.log("🔨 Injecting Draggable Overlay...");

    // 2. Create Host
    const host = document.createElement("div");
    host.id = HOST_ID;
    
    // Initial Position: Top Left
    host.style.cssText = `
      position: fixed;
      top: 150px;
      left: 20px;
      z-index: 2147483647;
      width: 0;
      height: 0;
      display: block !important;
    `;

    document.body.appendChild(host);

    // 3. Shadow DOM
    const shadow = host.attachShadow({ mode: "open" });

    // 4. Styles & HTML
    const wrapper = document.createElement("div");
    wrapper.id = "flo-box-wrapper";
    wrapper.innerHTML = `
      <style>
        .box {
          width: 300px;
          background-color: #ffffff;
          border: 3px solid #ce0e2d; 
          border-radius: 8px;
          padding: 15px;
          box-shadow: 0 5px 20px rgba(0,0,0,0.5);
          font-family: sans-serif;
          color: #333;
          display: flex;
          flex-direction: column;
          gap: 10px;
          cursor: move; /* Shows 'Move' cursor */
          user-select: none; /* Prevents text highlighting while dragging */
        }
        .header {
          margin: 0;
          font-size: 16px;
          font-weight: 800;
          color: #ce0e2d;
          text-align: left;
          pointer-events: none; /* Let clicks pass through to box for dragging */
        }
        .desc {
          font-size: 12px;
          color: #555;
          margin: 0;
          line-height: 1.4;
          pointer-events: none;
        }
        /* Input and Button need to be clickable, so we reset cursor */
        input {
          width: 100%;
          padding: 8px;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 12px;
          box-sizing: border-box;
          background: #fdfdfd;
          cursor: text; 
          user-select: text;
        }
        button {
          width: 100%;
          padding: 10px;
          background-color: #ce0e2d;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 13px;
          font-weight: bold;
          cursor: pointer;
        }
        button:hover {
          background-color: #b00c26;
        }
      </style>
      <div id="dragBox" class="box">
        <div class="header">Search Bot</div>
        <input id="urlInput" type="text" />
        <button id="confirmBtn">Confirm</button>
      </div>
    `;

    shadow.appendChild(wrapper);

    // 5. Logic
    const confirmBtn = shadow.getElementById("confirmBtn");
    const urlInput = shadow.getElementById("urlInput");
    const dragBox = shadow.getElementById("dragBox");

    // --- DRAG LOGIC ---
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    dragBox.addEventListener('mousedown', (e) => {
        // Don't drag if clicking input or button
        if (e.target === urlInput || e.target === confirmBtn) return;

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        // Get current computed position of the HOST element
        const rect = host.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        // Prevent default selection
        e.preventDefault();
    });

    // We attach mousemove/up to document so you can drag quickly outside the box
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        host.style.left = `${initialLeft + dx}px`;
        host.style.top = `${initialTop + dy}px`;
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // --- INPUT UPDATER ---
    setInterval(() => {
        if (document.activeElement !== urlInput && urlInput.value !== window.location.href) {
             urlInput.value = window.location.href; 
        }
    }, 1000);

    confirmBtn.addEventListener("click", () => {
      const finalUrl = urlInput.value;
      confirmBtn.innerText = "Sending...";
      confirmBtn.style.backgroundColor = "#4CAF50"; 
      
      chrome.runtime.sendMessage({
        action: 'botSearchComplete',
        url: finalUrl
      });
    });
  }

  // --- PERSISTENCE ---
  setInterval(injectRobustOverlay, 1000);
  injectRobustOverlay();

})();