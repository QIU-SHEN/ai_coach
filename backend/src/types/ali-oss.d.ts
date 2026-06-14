declare module 'ali-oss' {
  interface OSSOptions {
    region: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret: string;
    authorizationV4?: boolean;
    timeout?: string | number;
  }

  interface PutResult {
    name: string;
    url: string;
    res: {
      status: number;
      headers: Record<string, string>;
    };
  }

  interface GetResult {
    content: Buffer;
    res: {
      status: number;
      headers: Record<string, string>;
    };
  }

  class OSS {
    constructor(options: OSSOptions);
    put(name: string, file: string | Buffer): Promise<PutResult>;
    get(name: string): Promise<GetResult>;
    delete(name: string): Promise<{ res: { status: number } }>;
  }

  export = OSS;
}
