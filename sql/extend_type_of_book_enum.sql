-- Admin payment types: Payment Link, Bank Transfer, In Person, Zero Cost
ALTER TABLE bookings
  MODIFY COLUMN type_of_book
  ENUM('o','m','t','w','r','pl','bt','c','z') NOT NULL DEFAULT 't';
