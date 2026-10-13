// TadaBoo catalogue data (source: Tadaboo_Catalogue.pdf, 2026 collection).
// Prices are customer prices in ₹. `sid` links each product to its item id in the
// TadaBoo Stockroom so stock and costs can be joined later.
// To add a product: add a row here and a photo at img/<id>.webp.
window.TADABOO = {
  phone: "97306 24700",
  whatsapp: "919730624700",
  customMin: 299, // custom bags: chosen items must total more than this
  dispatchDays: "5–7 working days",

  categories: [
    { id: "pens", name: "Pens & Highlighters", line: "Write it, doodle it, make it sparkle." },
    { id: "paper", name: "Pencils, Notebooks & Notes", line: "Pencil boxes, pocket diaries, sticky notes and page-keepers." },
    { id: "sharp", name: "Sharpeners & Erasers", line: "Tiny treasures for every pencil case." },
    { id: "make", name: "Make & Create", line: "Hands-on fun for creative explorers." },
    { id: "gift", name: "Gift Sets & Squishy Fun", line: "Bigger treats for bigger smiles." },
  ],

  products: [
    // Pens & Highlighters
    { id: "korean-gel-pen", sid: "it-korean-gel-pen", cat: "pens", name: "Korean Kawaii Erasable Gel Pen 0.5mm", price: 30, desc: "0.5 mm retractable erasable gel pens with kawaii toppers.", tags: ["kawaii", "school", "girls"] },
    { id: "labubu-gel-pen", sid: "it-labubu-gel-pen", cat: "pens", name: "Labubu-themed Erasable Gel Pens", price: 20, desc: "0.35 mm ultra-fine erasable gel pens.", tags: ["kawaii", "return", "school"] },
    { id: "butterfly-pen", sid: "it-butterfly-pen", cat: "pens", name: "Butterfly Ornament Pen", price: 99, desc: "Butterfly-topped pen, assorted colours.", tags: ["girls", "aesthetic"] },
    { id: "10in1-pen", sid: "it-10in1-pen", cat: "pens", name: "10-in-1 Multicolor Character Pen", price: 99, desc: "Ten colours in one character pen.", tags: ["school", "any"] },
    { id: "crystal-cat-pen", sid: "it-trendy-15", cat: "pens", name: "Crystal Cat Pen", price: 45, desc: "Crystal cat-head topper and sparkly bead-filled barrel.", tags: ["girls", "kawaii"] },
    { id: "crystal-unicorn-pen", sid: "it-trendy-14", cat: "pens", name: "Crystal Unicorn Pen", price: 45, desc: "Unicorn-head pen with a glitter bead-filled barrel.", tags: ["girls", "unicorn"] },
    { id: "fountain-pen", sid: "it-trendy-10", cat: "pens", name: "Fountain Pen with Extra Ink", price: 80, desc: "Kids fountain pen with ink cartridges; fruit and animal designs.", tags: ["school", "any"] },
    { id: "light-up-pen", sid: "it-trendy-12", cat: "pens", name: "Light-Up Character Pen", price: 80, desc: "Character topper that lights up; pink, yellow, purple and more.", tags: ["boys", "any"] },
    { id: "icecream-pen", sid: "it-icecream-pen", cat: "pens", name: "Ice Cream Cone Pen", price: 129, desc: "Ice-cream cone shaped pen, assorted colours.", tags: ["sweet", "girls"] },
    { id: "popup-pen", sid: "it-trendy-13", cat: "pens", name: "Pop Up Pen – Panda & Cupcake", price: 129, desc: "Topped with a squishy pop-up panda or cupcake.", tags: ["sweet", "kawaii"] },
    { id: "popsicle-highlighter", sid: "it-popsicle-highlighter", cat: "pens", name: "Popsicle Highlighter", price: 30, desc: "Popsicle-shaped highlighters.", tags: ["sweet", "return", "school"] },

    // Pencils, Notebooks & Notes
    { id: "unicorn-pencils", sid: "it-unicorn-pencils", cat: "paper", name: "Unicorn Print 2B Pencil (Box of 12)", price: 109, desc: "Box of 12 for ₹109, or single pencils at ₹15.", tags: ["school", "girls", "unicorn"] },
    { id: "racing-pencils", sid: "it-racing-pencils", cat: "paper", name: "Racing Car Themed 2B Pencil (Box of 12)", price: 109, desc: "Box of 12 for ₹109, or single pencils at ₹15.", tags: ["school", "boys", "vroom"] },
    { id: "a7-notebook", sid: "it-a7-notebook", cat: "paper", name: "A7 Kawaii Mini Spiral Notebook", price: 80, desc: "Pocket notebook, ruled pages, cute animal covers.", tags: ["kawaii", "return", "school"] },
    { id: "snoopy-diary", sid: "it-snoopy-diary", cat: "paper", name: "Snoopy Diary", price: 149, desc: "Snoopy-themed diary, assorted designs.", tags: ["any", "kawaii"] },
    { id: "clipboard-diary", sid: "it-clipboard-diary", cat: "paper", name: "Kawaii Mini Clipboard Notepad Diary", price: 99, desc: "Mini clipboard-style notepad.", tags: ["kawaii", "school"] },
    { id: "kuromi-diary", sid: "it-kuromi-diary", cat: "paper", name: "Kuromi Shaker Beads Diary", price: 99, desc: "Character diary with shaker-bead cover.", tags: ["girls", "kawaii"] },
    { id: "donut-sticky", sid: "it-donut-sticky", cat: "paper", name: "Donut Sticky Note (Round)", price: 129, desc: "Round donut-shaped sticky notes.", tags: ["sweet"] },
    { id: "space-notes", sid: "it-kawaii-memo-pad", cat: "paper", name: "Space Notes Sticky Note Set", price: 70, desc: "Astronaut and UFO notes with tab markers.", tags: ["boys", "space"] },
    { id: "animal-memo-pad", sid: "it-aesthetic-sticky", cat: "paper", name: "Cute Animal Theme Sticky Note Memo Pad", price: 50, desc: "Animal sticky tabs in themed cases.", tags: ["kawaii", "school"] },
    { id: "magnetic-bookmark", sid: "it-trendy-09", cat: "paper", name: "Magnetic Bookmark Set", price: 50, desc: "Set of 6 magnetic bookmarks: kawaii, unicorn, astronaut.", tags: ["any", "return"] },

    // Sharpeners & Erasers
    { id: "helmet-sharpener", sid: "it-helmet-sharpener", cat: "sharp", name: "Helmet Shaped Pencil Sharpener", price: 40, desc: "Clear cover and easy-empty compartment.", tags: ["boys", "vroom", "school"] },
    { id: "shuttlecock-sharpener", sid: "it-shuttlecock-sharpener", cat: "sharp", name: "Badminton Shuttlecock Pencil Sharpener", price: 35, desc: "Shuttlecock sharpener with steel blade.", tags: ["boys", "any"] },
    { id: "plane-sharpener", sid: "it-plane-sharpener", cat: "sharp", name: "Plane Shaped Pencil Sharpener", price: 30, desc: "Airplane sharpener in assorted colours.", tags: ["return", "boys"] },
    { id: "rocket-sharpener", sid: "it-trendy-01", cat: "sharp", name: "Space Rocket Pencil Sharpener", price: 99, desc: "Rocket sharpener with clear window.", tags: ["boys", "space"] },
    { id: "cow-sharpener", sid: "it-trendy-02", cat: "sharp", name: "Cow Pencil Sharpener", price: 80, desc: "Cow sharpener in a gift cube; pink, mint, white.", tags: ["kawaii", "any"] },
    { id: "car-sharpener", sid: "it-trendy-03", cat: "sharp", name: "Car Pencil Sharpener", price: 60, desc: "Smiling car sharpener, assorted colours.", tags: ["boys", "vroom"] },
    { id: "camera-sharpener", sid: "it-trendy-04", cat: "sharp", name: "Camera Pencil Sharpener", price: 50, desc: "Unicorn camera sharpener in pastel colours.", tags: ["girls", "unicorn"] },
    { id: "toffee-eraser", sid: "it-toffee-eraser", cat: "sharp", name: "2-in-1 Toffee Eraser With Sharpener", price: 90, desc: "Toffee-shaped eraser and sharpener combo.", tags: ["sweet"] },
    { id: "sharpener-eraser", sid: "it-sharpener-eraser", cat: "sharp", name: "2-in-1 Sharpener Plus Eraser", price: 99, desc: "Sharpener and eraser combo, mixed designs.", tags: ["school", "any"] },
    { id: "camping-eraser", sid: "it-camping-eraser", cat: "sharp", name: "Camping Theme Cute Eraser Set", price: 70, desc: "Camping-themed animal and character erasers.", tags: ["any", "kawaii"] },
    { id: "rabbit-eraser", sid: "it-rabbit-eraser", cat: "sharp", name: "Rabbit Eraser", price: 30, desc: "Rabbit-shaped erasers, assorted colours.", tags: ["girls", "kawaii", "return"] },
    { id: "icecream-eraser", sid: "it-icecream-eraser", cat: "sharp", name: "Ice Cream Cone Eraser", price: 30, desc: "Ice-cream cone erasers, assorted colours.", tags: ["sweet", "school"] },
    { id: "donut-unicorn-eraser", sid: "it-donut-unicorn-eraser", cat: "sharp", name: "Donut Unicorn Eraser", price: 25, desc: "Donut and unicorn erasers, assorted.", tags: ["sweet", "unicorn", "girls"] },
    { id: "fast-food-eraser", sid: "it-trendy-05", cat: "sharp", name: "Fast Food Eraser", price: 20, desc: "3D burger, fries, hot dog and cola erasers.", tags: ["return", "sweet"] },
    { id: "fighter-plane-eraser", sid: "it-trendy-06", cat: "sharp", name: "Fighter Plane Eraser", price: 20, desc: "Puzzle-style fighter plane eraser.", tags: ["boys", "vroom", "space"] },
    { id: "eraser-combo", sid: "it-trendy-11", cat: "sharp", name: "Eraser Combo Pack", price: 99, desc: "Themed 3D erasers: space, sports, bowling or ice-cream.", tags: ["boys", "any"] },

    // Make & Create
    { id: "3d-sticker", sid: "it-3d-sticker", cat: "make", name: "DIY 3D Layering Sticker Set", price: 70, desc: "Ferris wheel, food and ocean themes.", tags: ["crafty", "return"] },
    { id: "diamond-bracelet", sid: "it-diamond-bracelet", cat: "make", name: "DIY Diamond Art Bracelet Craft Kit", price: 99, desc: "Make-your-own diamond-art bracelet.", tags: ["crafty", "girls"] },
    { id: "activity-set", sid: "it-activity-set", cat: "make", name: "3-in-1 Kids Activity Set", price: 199, desc: "Stickers, puzzle, mini watercolours and colouring.", tags: ["crafty", "boys"] },
    { id: "6in1-set", sid: "it-6in1-set", cat: "make", name: "Kids Stationery Set – 6-in-1 DIY Cartoon", price: 199, desc: "Pencils, sharpener, eraser, brush, watercolours and tray.", tags: ["crafty", "school"] },
    { id: "crayons-set", sid: "it-crayons-set", cat: "make", name: "Cute Crayons Stationery Set", price: 99, desc: "Crayon-based cute stationery set.", tags: ["crafty", "return"] },
    { id: "hamburger-glue", sid: "it-hamburger-glue", cat: "make", name: "Hamburger Glue Stick", price: 129, desc: "Hamburger-shaped glue stick.", tags: ["crafty", "sweet", "school"] },
    { id: "reward-stamps", sid: "it-trendy-08", cat: "make", name: "Reward Stamp Set", price: 129, desc: "10 self-inking reward stamps: smileys, flowers or sea animals.", tags: ["crafty", "any"] },

    // Gift Sets & Squishy Fun
    { id: "12pc-pencil-set", sid: "it-12pc-pencil-set", cat: "gift", name: "12 Pcs Pencil Stationery Gift Set", price: 199, desc: "12-piece pencil gift set, mixed designs.", tags: ["school", "any"] },
    { id: "8pc-aesthetic", sid: "it-8pc-aesthetic", cat: "gift", name: "8 Pcs Aesthetic Stationery Set", price: 249, desc: "8-piece aesthetic stationery set.", tags: ["aesthetic", "girls"] },
    { id: "7pc-aesthetic", sid: "it-7pc-aesthetic", cat: "gift", name: "7 Pcs Aesthetic Stationery Set", price: 299, desc: "7-piece aesthetic stationery set.", tags: ["aesthetic", "girls"] },
    { id: "chocolate-squishy", sid: "sjyw6kcu5knaynk3mtxv", cat: "gift", name: "Chocolate Bar Squishy", price: 199, desc: "Chocolate-bar squishy in assorted wrappers. Not food.", tags: ["sweet", "squishy"] },
    { id: "dumpling-squishy", sid: "7j1kki5qus1llbyd2lbl", cat: "gift", name: "Dumpling Bun Squishy", price: 249, desc: "Mystery dumpling squishy in a mini steamer.", tags: ["squishy", "kawaii"] },
    { id: "bath-bomb", sid: "3jm3u9w11dms5ncmkwik", cat: "gift", name: "Kids Bath Bomb", price: 99, desc: "Colourful fizzy bath bomb, assorted scents.", tags: ["any", "squishy"] },
  ],

  // Ready-made gift collections (catalogue pages 7–9).
  // `for`: girls | boys | any. `occasion`: school | create | themed | return | birthday.
  // `cover`: the product photo shown on the bag's card.
  bags: [
    { id: "bts-starter", cover: "labubu-gel-pen", name: "Back to School · Starter", price: 199, for: "any", occasion: "school", tint: "sky",
      items: ["unicorn-pencils", "labubu-gel-pen", "helmet-sharpener", "icecream-eraser"], note: "2B pencils: Unicorn or Racing Car." },
    { id: "bts-plus", cover: "12pc-pencil-set", name: "Back to School · Plus", price: 359, for: "any", occasion: "school", tint: "mint",
      items: ["12pc-pencil-set", "a7-notebook", "korean-gel-pen", "animal-memo-pad"] },
    { id: "make-create", cover: "6in1-set", name: "Make & Create", price: 497, for: "any", occasion: "create", tint: "butter",
      items: ["6in1-set", "diamond-bracelet", "3d-sticker", "hamburger-glue"] },
    { id: "vroom", cover: "racing-pencils", name: "Vroom Vroom · Boys", price: 249, for: "boys", occasion: "themed", tint: "mint",
      items: ["racing-pencils", "helmet-sharpener", "fighter-plane-eraser", "light-up-pen"] },
    { id: "space-cadet", cover: "rocket-sharpener", name: "Space Cadet · Boys", price: 399, for: "boys", occasion: "themed", tint: "sky",
      items: ["rocket-sharpener", "space-notes", "a7-notebook", "light-up-pen", "magnetic-bookmark", "fighter-plane-eraser"], note: "Astronaut magnetic bookmarks." },
    { id: "kuromi", cover: "kuromi-diary", name: "Kuromi Kawaii · Girls", price: 259, for: "girls", occasion: "themed", tint: "blush",
      items: ["kuromi-diary", "korean-gel-pen", "animal-memo-pad", "rabbit-eraser", "magnetic-bookmark"] },
    { id: "unicorn", cover: "crystal-unicorn-pen", name: "Unicorn Sparkle · Girls", price: 399, for: "girls", occasion: "themed", tint: "blush",
      items: ["crystal-unicorn-pen", "camera-sharpener", "donut-unicorn-eraser", "a7-notebook", "diamond-bracelet", "3d-sticker", "popsicle-highlighter"] },
    { id: "rg-mini", cover: "crayons-set", name: "Return Gift · Mini", price: 199, for: "any", occasion: "return", tint: "butter",
      items: ["crayons-set", "labubu-gel-pen", "plane-sharpener", "fast-food-eraser", "popsicle-highlighter"] },
    { id: "rg-classic", cover: "3d-sticker", name: "Return Gift · Classic", price: 349, for: "any", occasion: "return", tint: "sky",
      items: ["crayons-set", "a7-notebook", "3d-sticker", "labubu-gel-pen", "plane-sharpener", "fast-food-eraser", "popsicle-highlighter"] },
    { id: "rg-deluxe", cover: "chocolate-squishy", name: "Return Gift · Deluxe", price: 499, for: "any", occasion: "return", tint: "mint",
      items: ["chocolate-squishy", "a7-notebook", "3d-sticker", "animal-memo-pad", "magnetic-bookmark", "rabbit-eraser", "labubu-gel-pen"] },
    { id: "hamper-boys", cover: "dumpling-squishy", name: "Birthday Hamper · Boys", price: 999, for: "boys", occasion: "birthday", tint: "sky",
      items: ["dumpling-squishy", "activity-set", "reward-stamps", "racing-pencils", "eraser-combo", "bath-bomb", "light-up-pen", "shuttlecock-sharpener"], note: "Activity set: Space or Dino. Eraser combo: Space or Sports." },
    { id: "hamper-girls", cover: "7pc-aesthetic", name: "Birthday Hamper · Girls", price: 999, for: "girls", occasion: "birthday", tint: "blush",
      items: ["7pc-aesthetic", "dumpling-squishy", "kuromi-diary", "butterfly-pen", "diamond-bracelet", "bath-bomb", "popsicle-highlighter", "donut-unicorn-eraser"] },
  ],
};
