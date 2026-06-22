/* =============================================================================
 * markus.js — public MarkUS browser asset.
 *
 * This lightweight entrypoint preserves one implementation file during the
 * product rename. It forwards the embedding script's data-* configuration to
 * annotate.js, then exposes the same API as window.MarkUS and window.Annotate.
 * ========================================================================== */
(function () {
  "use strict";

  if (window.MarkUS && window.Annotate) return;

  var SCRIPT = document.currentScript ||
    document.querySelector('script[src*="markus"]');

  function annotateSrc() {
    var src = SCRIPT && SCRIPT.getAttribute("src");
    try {
      return new URL("annotate.js", src ? new URL(src, document.baseURI) : document.baseURI).href;
    } catch (e) {
      return "annotate.js";
    }
  }

  function mirrorConfig(toScript) {
    if (!SCRIPT) return;
    Array.prototype.forEach.call(SCRIPT.attributes, function (attr) {
      if (attr.name.indexOf("data-") === 0 || attr.name === "nonce") {
        toScript.setAttribute(attr.name, attr.value);
      }
    });
  }

  function aliasApi() {
    if (window.Annotate) window.MarkUS = window.Annotate;
  }

  if (window.Annotate) {
    aliasApi();
    return;
  }

  var loader = document.createElement("script");
  loader.src = annotateSrc();
  loader.async = false;
  mirrorConfig(loader);
  loader.addEventListener("load", aliasApi);
  (document.head || document.documentElement).appendChild(loader);
})();
