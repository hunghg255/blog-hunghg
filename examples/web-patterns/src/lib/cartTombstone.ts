/**
 * "Bia mộ" (tombstone) cho dòng sản phẩm vừa xoá khỏi giỏ hàng.
 * Ý tưởng từ Best Buy Canada (business-rules/use-cases/CartRemover.ts + cartMerger.ts):
 * server trả về giỏ hàng MỚI không còn dòng đã xoá; client chèn lại dòng đó, đánh dấu
 * `removed: true`, ĐÚNG vị trí cũ. UI hiện "Đã xoá X khỏi giỏ" thay cho dòng đó, nên các dòng
 * bên dưới không bị nhảy lên và người dùng biết chắc mình vừa xoá cái gì.
 */

export interface LineItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  removed?: boolean;
}

export interface Shipment {
  sellerId: string;
  sellerName: string;
  lineItems: LineItem[];
}

/** Đánh dấu dòng `lineItemId` là đã xoá, trả về mảng MỚI (Best Buy sửa trực tiếp object cũ). */
export function flagRemoved(shipments: Shipment[], lineItemId: string): Shipment[] {
  return shipments.map((shipment) =>
    shipment.lineItems.some((li) => li.id === lineItemId)
      ? {
          ...shipment,
          lineItems: shipment.lineItems.map((li) => (li.id === lineItemId ? { ...li, removed: true } : li)),
        }
      : shipment,
  );
}

/**
 * Ghép các tombstone từ giỏ cũ vào giỏ mới mà server trả về.
 * - Seller còn trong giỏ mới: chèn dòng đã xoá vào đúng chỉ số cũ trong shipment đó.
 * - Seller không còn (dòng cuối cùng của seller vừa bị xoá): chèn lại cả shipment, chỉ chứa
 *   tombstone, ở đúng vị trí cũ.
 * - Giỏ mới rỗng: giữ nguyên giỏ cũ (chỉ còn tombstone), để vẫn hiện được thông báo.
 */
export function mergeTombstones(next: Shipment[], prev: Shipment[]): Shipment[] {
  if (next.length === 0) return prev.map((s) => ({ ...s, lineItems: s.lineItems.filter((li) => li.removed) }));

  let result = next.map((s) => ({ ...s, lineItems: [...s.lineItems] }));
  prev.forEach((oldShipment, shipmentIndex) => {
    oldShipment.lineItems.forEach((item, itemIndex) => {
      if (!item.removed) return;
      const target = result.find((s) => s.sellerId === oldShipment.sellerId);
      if (target) {
        // không chèn trùng nếu server (hoặc lần ghép trước) đã có dòng này
        if (target.lineItems.some((li) => li.id === item.id)) return;
        target.lineItems.splice(Math.min(itemIndex, target.lineItems.length), 0, { ...item });
      } else {
        const ghost: Shipment = { ...oldShipment, lineItems: [{ ...item }] };
        result = [...result.slice(0, shipmentIndex), ghost, ...result.slice(shipmentIndex)];
      }
    });
  });
  return result;
}

/** Bỏ hết tombstone, ví dụ khi người dùng rời trang giỏ hàng hoặc tải lại giỏ. */
export const dropTombstones = (shipments: Shipment[]) =>
  shipments
    .map((s) => ({ ...s, lineItems: s.lineItems.filter((li) => !li.removed) }))
    .filter((s) => s.lineItems.length > 0);

/** Tổng tiền: tombstone không được tính. */
export const cartTotal = (shipments: Shipment[]) =>
  shipments.reduce(
    (sum, s) => sum + s.lineItems.reduce((acc, li) => acc + (li.removed ? 0 : li.price * li.quantity), 0),
    0,
  );
