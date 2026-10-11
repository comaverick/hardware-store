const BranchInventory = require("../models/BranchInventory");
const { fail } = require("./stockOperations");

// Staff holds created before customer checkout contain one product.
const reservationItems = (reservation) => reservation.items?.length
  ? reservation.items
  : [{ product: reservation.product, quantity: reservation.quantity }];

async function releaseReservationStock(reservation, session, InventoryModel = BranchInventory) {
  for (const item of reservationItems(reservation)) {
    const released = await InventoryModel.findOneAndUpdate({
      branch: reservation.branch,
      product: item.product?._id || item.product,
      reservedQuantity: { $gte: item.quantity },
    }, { $inc: { reservedQuantity: -item.quantity } }, { new: true, session });
    if (!released) fail(409, "Reservation stock could not be released. Please contact the branch.");
  }
}

module.exports = { reservationItems, releaseReservationStock };
