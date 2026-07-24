-- Hotspot Regions: group sites by region
CREATE TABLE hotspot_regions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_company_region_name (company_id, name),
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

ALTER TABLE hotspot_sites
  ADD COLUMN region_id INT NULL AFTER location,
  ADD FOREIGN KEY (region_id) REFERENCES hotspot_regions(id);
