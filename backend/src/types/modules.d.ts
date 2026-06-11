declare module 'jsonwebtoken' {
  export function sign(payload: object, secret: string, options?: object): string;
  export function verify(token: string, secret: string, options?: object): object;
  export function decode(token: string): object | null;
}

declare module 'pdf-parse' {
  function pdfParse(dataBuffer: Buffer): Promise<{ text: string; numpages: number; info: Record<string, unknown> }>;
  export = pdfParse;
}
