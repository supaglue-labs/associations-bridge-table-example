import axios from 'axios';

export type PassthroughRequest = {
  path: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: Record<string, any>;
  query?: Record<string, any>;
  customerId: string;
  providerName: string;
};

export class SupaglueClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  public constructor(baseUrl: string, apiKey: string) {
    this.#baseUrl = baseUrl;
    this.#apiKey = apiKey;
  }

  getHeaders(customerId: string, providerName: string) {
    return {
      'x-api-key': this.#apiKey,
      'x-customer-id': customerId,
      'x-provider-name': providerName,
      'Content-Type': 'application/json',
    };
  }

  async passthrough<T>({ path, method, body, query, customerId, providerName }: PassthroughRequest): Promise<T> {
    const response = await axios.request<T>({
      url: `${this.#baseUrl}/actions/v2/passthrough`,
      method: 'POST',
      headers: this.getHeaders(customerId, providerName),
      data: {
        method,
        path,
        query,
        body,
      },
    });
    return response.data;
  }
}
