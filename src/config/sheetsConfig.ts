/**
 * Configuração global da URL do Google Apps Script (/exec).
 * Quando preenchida aqui (ou via variável de ambiente VITE_APPS_SCRIPT_URL no Netlify),
 * TODOS os links (navegador, celular, Netlify e APK) já abrem conectados automaticamente
 * na mesma planilha, sem precisar colar a URL aparelho por aparelho.
 */

const BAKED_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzHXdHIE1qw-DVg8ljVjYaTdO3IYdjtQTBDBJwPD5he40w4oh_wCAuQy_pud9WCNhaOog/exec';

function readEnvAppsScriptUrl(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> })?.env;
    return (env?.VITE_APPS_SCRIPT_URL || '').trim();
  } catch {
    return '';
  }
}

export const DEFAULT_APPS_SCRIPT_URL: string =
  readEnvAppsScriptUrl() || BAKED_APPS_SCRIPT_URL.trim();

/**
 * Link público padrão do app publicado no AI Studio (Shared App URL) e sua URL curta.
 * Requer que o botão "Share / Publish" esteja ativo no projeto para abrir sem conta de desenvolvedor.
 */
export const PUBLIC_SHARED_APP_URL =
  'https://ais-pre-6ji7f4hlumvf23ycg3dpnb-876516775031.us-east1.run.app';

export const PUBLIC_SHORT_APP_URL = 'https://tinyurl.com/2bgs6erl';
