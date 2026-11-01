/*
 * Estande offline: o PC do estande guarda a página, o código do site, o modelo 3D e as texturas. Se a internet cair
 * (ou o PC recarregar sozinho sem internet), o 3D abre do que já foi guardado.
 *
 * Sempre rede primeiro: com internet, tudo vem novo (preço, situação, versão do site); o guardado só entra quando a
 * rede falha. Só GET: ações do servidor (sinal de vida, eventos) e o canal ao vivo passam direto, nunca do guardado.
 */
const CACHE = 'imersa-estande-v1';
/** Página demorando mais que isto: abre a guardada (rede ruim no estande). */
const ESPERA_PAGINA_MS = 6000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const nome of await caches.keys()) if (nome.startsWith('imersa-estande-') && nome !== CACHE) await caches.delete(nome);
      await self.clients.claim();
    })(),
  );
});

/**
 * Chave do guardado. Arquivos de outro endereço (modelo e texturas no armazenamento) vêm com assinatura temporária
 * na URL, que muda a cada abertura: a chave é o caminho, sem a assinatura.
 */
function chave(req) {
  const url = new URL(req.url);
  if (url.origin === self.location.origin) return req.url;
  return url.origin + url.pathname;
}

async function redePrimeiro(req, esperaMs) {
  const cache = await caches.open(CACHE);
  const k = chave(req);
  const daRede = fetch(req).then(async (r) => {
    // resposta opaca (sem CORS) não dá para saber se deu certo: não guarda
    if (r.ok && r.type !== 'opaque') await cache.put(k, r.clone()).catch(() => undefined);
    return r;
  });
  if (!esperaMs) {
    try {
      return await daRede;
    } catch (erro) {
      const guardada = await cache.match(k);
      if (guardada) return guardada;
      throw erro;
    }
  }
  // página: se a rede demorar, abre a guardada (e a nova fica guardada para a próxima)
  const guardada = await cache.match(k);
  if (!guardada) return daRede;
  return Promise.race([daRede.catch(() => guardada), new Promise((ok) => setTimeout(() => ok(guardada), esperaMs))]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if ((req.headers.get('accept') ?? '').includes('text/event-stream')) return; // canal ao vivo
  if (url.pathname.startsWith('/_next/webpack-hmr') || url.pathname.includes('__nextjs')) return; // só no dev
  e.respondWith(redePrimeiro(req, req.mode === 'navigate' ? ESPERA_PAGINA_MS : 0));
});
