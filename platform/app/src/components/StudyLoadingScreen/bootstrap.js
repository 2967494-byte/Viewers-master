// Mount once, before the application. The shadow tree survives React route changes.
(function () {
  var host = document.getElementById('orbital-study-loader');
  if (!host || host.shadowRoot) return;
  var template = host.querySelector('template');
  if (!template) return;
  host.attachShadow({ mode: 'open' }).appendChild(template.content);
  template.remove();
})();
