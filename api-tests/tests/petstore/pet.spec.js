import { test, expect } from '../../src/fixtures/index.js';

test.describe('Pet API', () => {
  test('creates a pet from generated data and reads it back', { tag: ['@smoke'] }, async ({ api, data }) => {
    const pet = data.build('addPet', { id: data.uniqueId(), status: 'available' });

    const created = await api.call('addPet', { body: pet });
    expect(created).toHaveStatus(200);
    expect(created.body).toMatchObject({ id: pet.id, name: pet.name, status: 'available' });

    const fetched = await api.call('getPetById', { path: { petId: pet.id } });
    expect(fetched).toHaveStatus(200);
    expect(fetched.body.name).toBe(pet.name);
    expect(fetched).toRespondWithin(5_000);
    // addPet is auto-deleted after the test (config: services.petstore.cleanup.addPet)
  });

  test('updates a pet status', { tag: ['@regression'] }, async ({ api, data }) => {
    const pet = data.build('addPet', { id: data.uniqueId(), status: 'available' });
    await api.call('addPet', { body: pet });

    const updated = await api.call('updatePet', { body: { ...pet, status: 'sold' } });
    expect(updated).toHaveStatus(200);
    expect(updated.get('$.status')).toBe('sold');
  });

  test('deleted pet is no longer found', { tag: ['@regression'] }, async ({ api, data }) => {
    const { id } = (await api.call('addPet', { body: data.build('addPet', { id: data.uniqueId() }) })).body;

    expect(await api.call('deletePet', { path: { petId: id } })).toHaveStatus(200);
    expect(await api.call('getPetById', { path: { petId: id } })).toHaveStatus(404);
  });

  test('finds pets by every status value', { tag: ['@regression'] }, async ({ api, framework }) => {
    const statusParam = framework.registry.get('findPetsByStatus').parameters.find((p) => p.name === 'status');

    for (const status of statusParam.schema.enum) {
      // Schema checks are skipped here: shared demo data violates the schema (tracked in suites.knownIssues).
      const res = await api.call('findPetsByStatus', { query: { status }, validate: false });
      expect(res).toHaveStatus(200);
      expect(res.body.every((p) => p.status === status)).toBe(true);
    }
  });

  test('raw path requests are still schema-validated', { tag: ['@regression'] }, async ({ api, data }) => {
    const { id } = (await api.call('addPet', { body: data.build('addPet') })).body;

    const res = await api.get(`/pet/${id}`);
    expect(res).toHaveStatus(200);
    expect(res.operation?.id).toBe('getPetById');
    expect(res).toMatchSchema();
  });
});
