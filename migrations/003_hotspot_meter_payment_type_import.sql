-- Run this migration before deploying the Hotspot Management v2 changes
-- (meter reading + payment type per payment, optional location/agreement_type, free-text status, Excel import upsert key)
ALTER TABLE hotspot_sites
  MODIFY COLUMN location VARCHAR(255) NULL,
  MODIFY COLUMN agreement_type ENUM('power_tokens','amount','free_voucher') NULL,
  MODIFY COLUMN status VARCHAR(255) NOT NULL DEFAULT 'pending',
  ADD UNIQUE KEY uniq_company_site_name (company_id, site_name);

ALTER TABLE hotspot_site_transactions
  ADD COLUMN payment_type ENUM('power_tokens','amount','free_voucher') NOT NULL DEFAULT 'amount' AFTER amount,
  ADD COLUMN meter_reading DECIMAL(10,2) NULL AFTER paid_on;
