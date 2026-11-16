export class DataError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'invalid_data',
  ) {
    super(message);
    this.name = 'DataError';
  }
}
