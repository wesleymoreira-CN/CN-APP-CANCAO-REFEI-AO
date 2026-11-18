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
