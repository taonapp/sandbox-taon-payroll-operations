/**
 * Refresh Bar Component
 * Usage: initRefreshBar(containerSelector, reloadFunction)
 */
function initRefreshBar(containerId, reloadFn) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="refresh-bar">
      <div class="refresh-btn" id="refreshBtn">
        <svg class="refresh-icon" id="refreshIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
        <span>Atualizar</span>
      </div>
      <div class="refresh-divider"></div>
      <div class="auto-refresh">
        <div class="auto-refresh-indicator" id="autoRefreshDot"></div>
        <label class="auto-refresh-label">Auto:</label>
        <select class="auto-refresh-select" id="autoRefreshSelect">
          <option value="0">Desligado</option>
          <option value="5">5s</option>
          <option value="10">10s</option>
          <option value="30">30s</option>
          <option value="60">1 min</option>
          <option value="300">5 min</option>
          <option value="900">15 min</option>
          <option value="1800">30 min</option>
          <option value="3600">1 hora</option>
        </select>
      </div>
    </div>
  `;

  const btn = document.getElementById('refreshBtn');
  const icon = document.getElementById('refreshIcon');
  const select = document.getElementById('autoRefreshSelect');
  const dot = document.getElementById('autoRefreshDot');
  let intervalId = null;
  let isLoading = false;

  function startSpin() {
    icon.style.animation = 'refresh-spin 0.8s linear infinite';
    btn.classList.add('loading');
  }

  function stopSpin() {
    icon.style.animation = '';
    btn.classList.remove('loading');
  }

  async function doRefresh() {
    if (isLoading) return;
    isLoading = true;
    startSpin();

    try {
      const minDelay = new Promise(r => setTimeout(r, 400));
      await Promise.all([reloadFn(), minDelay]);
    } catch (e) {
      console.error('Refresh error:', e);
    } finally {
      stopSpin();
      isLoading = false;
    }
  }

  function setAutoRefresh(seconds) {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }

    if (seconds > 0) {
      dot.classList.add('active');
      intervalId = setInterval(doRefresh, seconds * 1000);
    } else {
      dot.classList.remove('active');
    }
  }

  btn.addEventListener('click', doRefresh);

  select.addEventListener('change', () => {
    setAutoRefresh(Number(select.value));
  });

  window.addEventListener('beforeunload', () => {
    if (intervalId) clearInterval(intervalId);
  });

  return { refresh: doRefresh, setAutoRefresh };
}
