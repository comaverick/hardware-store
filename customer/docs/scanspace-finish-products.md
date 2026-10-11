# ScanSpace finish products

Room paint and flooring choices share their names, colors, and finish IDs with `src/features/scanspace/finishCatalog.json`. The catalog seed reads the same definitions so the room preview and purchasable items match.

From `server`, run `npm run seed:scanspace-finishes` to preview missing products and photos. Add `-- --apply` to insert them and their initial branch stock in one transaction. Repeating the seed adds photos to existing products that have none, while preserving existing photos, product prices, quantities, and reservations.

The presentation catalog has eight paint colors in Matte, Eggshell, and Satin (24 products), plus four flooring products. Paint costs ₱980 per 4 L can. Soft stone tile costs ₱720 per 1.44 m² box; wood and vinyl flooring cost ₱1,600 per 2.2 m² box. Newly created stock starts at 20 units per active branch. Purchasing costs are left at zero until supplied by the store.

Storefront products expose `scanSpace.paintFinish` or `scanSpace.floorFinishId` alongside their color and package coverage. ScanSpace uses that metadata to find the exact product. It adds the selected quantity to the existing reservation cart and opens the normal branch pickup flow. Available branch stock and quantities already in the cart limit additions. Stock is held only when the customer confirms a reservation.

Captured scans have a separate **Applied items** section below the room preview and finish controls. It lists only finishes committed with **Apply to room**, combines identical wall and ceiling paint, and keeps staged finish choices out of the shopping list. Customers set package quantities manually, then use checkboxes with **Add selected**, or **Add all** to include every applied product. A group is validated against branch stock before the cart is updated; unavailable finishes remain visible and cannot be substituted with a different product. Resetting the room finishes clears the list without removing products already added to the cart.

Imported scans can retain previously saved colors; arbitrary color picking is removed from both the captured-scan panel and the measured-room editor. Only matching store products can be added to the cart.

Product photos are generated presentation assets stored in `server/public/scanspace` and served by the API under `/assets/scanspace`. Each paint color has one can photo shared across its three finishes; each flooring type has its own material photo. Catalog, detail, and cart views all use the product's image URL.
