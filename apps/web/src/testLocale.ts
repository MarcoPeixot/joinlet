import { vi } from 'vitest';
// Existing copy assertions exercise Portuguese; locale-specific tests override this explicitly.
vi.stubGlobal('location', { search: '?lang=pt-BR' });
