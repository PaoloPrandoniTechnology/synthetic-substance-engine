/**
 * Wrangler importa i profili come moduli di testo (regola `Text` in wrangler.jsonc),
 * così il bundle contiene il catalogo vero invece di una copia.
 */
declare module "*.yaml" {
  const source: string;
  export default source;
}
