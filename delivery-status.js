// A skipped or rejected platform is not proof of delivery.
function deliveryStatus(results) {
  const deliveries = Object.values(results);
  const delivered = deliveries.filter(result => result.success === true && !result.skipped).length;
  return {
    status: delivered === 0 ? 'failed' : delivered === deliveries.length ? 'published' : 'partial',
    success: deliveries.length > 0 && delivered === deliveries.length,
    delivered: delivered > 0
  };
}

module.exports = deliveryStatus;
