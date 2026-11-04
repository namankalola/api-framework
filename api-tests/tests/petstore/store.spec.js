import { test, expect } from '../../src/fixtures/index.js';

test.describe('Store API', () => {
  test('places an order for a new pet and retrieves it', { tag: ['@smoke'] }, async ({ api, data }) => {
    const pet = (await api.call('addPet', { body: data.build('addPet', { id: data.uniqueId() }) })).body;
    const order = data.build('placeOrder', { id: data.uniqueId(), petId: pet.id, quantity: 1, status: 'placed' });

    const placed = await api.call('placeOrder', { body: order });
    expect(placed).toHaveStatus(200);
    expect(placed.body).toMatchObject({ petId: pet.id, status: 'placed' });

    const fetched = await api.call('getOrderById', { path: { orderId: order.id } });
    expect(fetched).toHaveStatus(200);
    expect(fetched).toMatchSchema('Order');
  });

  test('inventory is a map of status to count, also without credentials', { tag: ['@regression'] }, async ({ api }) => {
    const res = await api.as('anonymous').call('getInventory');
    expect(res).toHaveStatus(200);
    expect(res).toHaveHeader('content-type', /json/);
    expect(Object.values(res.body).every(Number.isInteger)).toBe(true);
  });
});
