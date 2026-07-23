-- Add "Free Wi-Fi" as a third agreement/payment settlement option
ALTER TABLE hotspot_sites
  MODIFY COLUMN agreement_type ENUM('power_tokens','amount','free_voucher','free_wifi') NULL;

ALTER TABLE hotspot_site_transactions
  MODIFY COLUMN payment_type ENUM('power_tokens','amount','free_voucher','free_wifi') NOT NULL DEFAULT 'amount';
