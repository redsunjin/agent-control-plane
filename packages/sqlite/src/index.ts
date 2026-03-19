export interface SqliteAdapterOptions {
  filename: string;
}

export class SqliteAdapter {
  constructor(public readonly options: SqliteAdapterOptions) {}
}
