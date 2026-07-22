-- Run this migration before deploying the Hotspot Management feature (sites + payments)
CREATE TABLE hotspot_sites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  site_name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  location VARCHAR(255) NOT NULL,
  agreement_type ENUM('power_tokens','amount','free_voucher') NOT NULL,
  agreement_value DECIMAL(10,2) NULL,
  agreement_notes VARCHAR(255) NULL,
  status ENUM('pending','installed') NOT NULL DEFAULT 'pending',
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE hotspot_site_houses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  site_id INT NOT NULL,
  house_label VARCHAR(255) NOT NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES hotspot_sites(id) ON DELETE CASCADE
);

CREATE TABLE hotspot_site_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  site_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  for_month DATE NOT NULL,
  paid_on DATE NOT NULL,
  notes VARCHAR(255) NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_site_month (site_id, for_month),
  FOREIGN KEY (site_id) REFERENCES hotspot_sites(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
