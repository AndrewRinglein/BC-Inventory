-- BC Inventory — seed: one location, the four distributors and the 38 games from
-- "Ticket Form Numbers & Info.xlsx". Cost is blank in the sheet (0 here = not known yet).
-- Ticket count = ideal gross receipts ($1 per ticket).

insert into halls (id, name) values ('bc', 'BC');

insert into vendors (id, name, email) values
  ('lib', 'Liberty Gaming', ''),
  ('tm', 'T&M Merchandising, Inc.', ''),
  ('clk', 'Clarko', ''),
  ('lan', 'Lancaster', '');

insert into products (id, vendor_id, name, form_number, cost, tickets, ideal_gross_receipts, ideal_cash_prize,
                      ideal_profit, non_cash_prize_value, net_profit, progressive_amount, progressive_note) values
  ('G001', 'lib', 'Speedy Bingo', '6516', 0, 154, 154, 100, 54, 0, 54, 0, null),
  ('G002', 'lib', 'Shamrocks', 'SR3', 0, 180, 180, 130, 50, 0, 54, 0, null),
  ('G003', 'lib', 'Playing for Peanuts', 'PFP225', 0, 375, 375, 225, 120, 0, 120, 0, null),
  ('G004', 'tm', 'The Wizard of Oz', '40JN', 0, 200, 200, 140, 60, 0, 60, 0, null),
  ('G005', 'tm', 'Zoltar Speaks', '7493S', 0, 200, 200, 140, 60, 0, 60, 0, null),
  ('G006', 'tm', 'Eagle Dab', '7143W', 0, 230, 230, 140, 90, 0, 90, 0, null),
  ('G007', 'tm', 'Be-Witched', '52395', 0, 182, 182, 130, 52, 0, 52, 0, null),
  ('G008', 'tm', 'Super Troll', 'STR3', 0, 240, 240, 175, 65, 0, 65, 0, null),
  ('G009', 'tm', 'Candy Pack', '6747U', 0, 250, 250, 175, 75, 0, 75, 0, null),
  ('G010', 'tm', 'Mini Flashboard 2', '4854', 0, 200, 200, 125, 75, 0, 75, 25, null),
  ('G011', 'clk', 'Get the Rest', '53379', 0, 1176, 1176, 907, 269, 0, 269, 0, null),
  ('G012', 'clk', 'Jackpot Derby', '52266', 0, 1806, 1806, 1400, 406, 0, 406, 300, null),
  ('G013', 'tm', 'Genevieve''s & Mike''s 4 Corner Diamonds', '4870', 0, 2016, 2016, 1380, 636, 0, 636, 0, null),
  ('G014', 'lib', '4 Corner - $250', 'XCR2', 0, 455, 455, 320, 135, 0, 135, 0, null),
  ('G015', 'lib', '4 Corner - $500', 'CR3', 0, 945, 945, 665, 280, 0, 280, 0, null),
  ('G016', 'lib', '4 Corner - $1000', 'CR5', 0, 1995, 1995, 1380, 615, 0, 615, 0, null),
  ('G017', 'lib', 'Side Saddles (small)', 'SSD3', 0, 1890, 1890, 1330, 560, 0, 560, 0, null),
  ('G018', 'lib', 'Queen of the Mountain', '6613', 0, 2700, 2700, 1910, 790, 0, 790, 0, null),
  ('G019', 'lib', '4 Corners Plus', 'CR9', 0, 1575, 1575, 1185, 390, 0, 390, 0, null),
  ('G020', 'lib', 'Side Saddles (large)', 'SSD4', 0, 3920, 3920, 3029, 961, 0, 961, 0, null),
  ('G021', 'lan', 'King of the Mountain', '21520', 0, 1700, 1700, 1312, 388, 0, 388, 0, null),
  ('G022', 'lib', 'Grand Banks', '57AK', 0, 3180, 3180, 2559, 621, 0, 621, 0, null),
  ('G023', 'lib', 'Triple Trolls', 'TL5', 0, 2450, 2450, 1782, 668, 0, 668, 0, null),
  ('G024', 'lib', 'Lucky Puppy', 'LP500', 0, 1540, 1540, 1125, 415, 0, 415, 0, null),
  ('G025', 'lib', 'Best Friends', 'BFR500', 0, 1500, 1500, 1125, 375, 0, 375, 0, null),
  ('G026', 'clk', 'Cow Jockeys', 'BP52634', 0, 840, 840, 630, 210, 0, 210, 0, null),
  ('G027', 'lib', 'Game Time Joe', '227Q', 0, 2310, 2310, 1875, 435, 0, 435, 0, null),
  ('G028', 'lib', 'Pyro Joe', '227R', 0, 2310, 2310, 1875, 435, 0, 435, 0, null),
  ('G029', 'lib', 'Big Weiners', 'BNB132N', 0, 3300, 3300, 2550, 750, 0, 750, 0, null),
  ('G030', 'lan', 'Wild Unicorn', '6303W', 0, 1060, 1060, 790, 300, 0, 300, 0, null),
  ('G031', 'lib', 'Super 10X Pays', 'S10', 0, 2700, 2700, 2100, 600, 0, 600, 0, null),
  ('G032', 'tm', '$599 Flashboard', 'BP53380', 0, 1792, 1792, 1331, 461, 0, 461, 300, null),
  ('G033', 'tm', 'Freedom Flashboard', '52190E', 0, 1582, 1582, 1194, 388, 0, 388, 350, 'Red: 200, White: 100, Blue: 50'),
  ('G034', 'tm', 'Wildball Flashboard', 'BP5520E', 0, 1512, 1512, 1114, 398, 0, 398, 250, null),
  ('G035', 'tm', 'Wildball Flashboard', 'BP53672', 0, 1568, 1568, 1114, 454, 0, 454, 250, null),
  ('G036', 'tm', '$1199 Flashboard', 'BP53374', 0, 2604, 2604, 1811, 793, 0, 793, 0, null),
  ('G037', 'tm', 'Mega Flashboard', '53383', 0, 3444, 3444, 2490, 954, 0, 954, 0, null),
  ('G038', 'lib', 'Bingo Stack', 'BSTAC1', 0, 750, 750, 512.5, 237.5, 0, 237.5, 0, null);

insert into settings (key, value) values
  ('admin_pin', '{"pin": "1234"}'),
  ('email', '{"testMode": true, "testAddress": "", "fromAddress": "", "accountingAddress": ""}'),
  ('po_sequence', '{}'),
  ('halls_config', '{"bc": {"address": ""}}'),
  ('sender', '{"bc": {"name": "", "org": ""}}');
