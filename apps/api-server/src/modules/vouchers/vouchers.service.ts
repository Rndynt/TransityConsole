import * as repo from "./vouchers.repository.js";

export interface VoucherValidationResult {
  valid: boolean;
  discountType?: string;
  discountValue?: number;
  finalAmount?: number;
  message: string;
}

export async function validateVoucher(
  code: string,
  totalAmount: number,
  operatorId?: string
): Promise<VoucherValidationResult> {
  const voucher = await repo.findByCode(code);

  if (!voucher || !voucher.active) {
    return { valid: false, message: "Kode voucher tidak valid atau sudah kadaluarsa." };
  }

  const now = new Date();
  if (now < voucher.validFrom) {
    return { valid: false, message: "Voucher belum berlaku." };
  }
  if (now > voucher.validUntil) {
    return { valid: false, message: "Voucher sudah kadaluarsa." };
  }

  if (voucher.usageLimit !== null && voucher.usedCount >= voucher.usageLimit) {
    return { valid: false, message: "Voucher sudah mencapai batas penggunaan." };
  }

  if (voucher.operatorId && operatorId && voucher.operatorId !== operatorId) {
    return { valid: false, message: "Voucher tidak berlaku untuk operator ini." };
  }

  const minPurchase = parseFloat(String(voucher.minPurchase ?? "0"));
  if (minPurchase > 0 && totalAmount < minPurchase) {
    return {
      valid: false,
      message: `Minimum pembelian Rp${minPurchase.toLocaleString("id-ID")} untuk voucher ini.`,
    };
  }

  let discountAmount: number;
  if (voucher.discountType === "percentage") {
    discountAmount = Math.round(totalAmount * parseFloat(String(voucher.discountValue)) / 100);
    const maxDiscount = parseFloat(String(voucher.maxDiscount ?? "0"));
    if (maxDiscount > 0 && discountAmount > maxDiscount) {
      discountAmount = maxDiscount;
    }
  } else {
    discountAmount = parseFloat(String(voucher.discountValue));
  }

  if (discountAmount > totalAmount) {
    discountAmount = totalAmount;
  }

  const finalAmount = totalAmount - discountAmount;
  const discountFormatted = `Rp${discountAmount.toLocaleString("id-ID")}`;

  return {
    valid: true,
    discountType: voucher.discountType,
    discountValue: discountAmount,
    finalAmount,
    message: `Voucher berhasil diterapkan! Diskon ${discountFormatted}`,
  };
}

export async function reserveVoucher(code: string): Promise<boolean> {
  const voucher = await repo.findByCode(code);
  if (!voucher) return false;
  return repo.atomicIncrementUsedCount(voucher.id, voucher.usageLimit);
}
