/* Política compartida por Express y las vistas, sin dependencias. */
(function (root) {
  const isMobile = (ua) => /Android|iPhone|iPad|iPod|Mobile|IEMobile|Windows Phone|BlackBerry|Opera Mini|webOS|Silk|Kindle/i.test(ua || '');
  if (typeof module === 'object' && module.exports) {
    module.exports = { isMobile };
    return;
  }
  const update = () => {
    const blocked = isMobile(navigator.userAgent) || navigator.userAgentData?.mobile === true ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
      window.matchMedia('(max-width: 767px)').matches;
    document.documentElement.classList.toggle('desktop-blocked', blocked);
    return blocked;
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('pageshow', update);
  document.addEventListener('submit', (event) => {
    if (update()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})(typeof window === 'undefined' ? globalThis : window);
