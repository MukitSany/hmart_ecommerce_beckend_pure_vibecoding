require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Setting = require('../models/Setting');
const { Campaign, Coupon } = require('../models/Marketing');
const { slugify } = require('../utils/helpers');

const img = (text, bg = 'f3f4f6') => `https://placehold.co/600x600/${bg}/1f2937?text=${encodeURIComponent(text)}`;
const banner = (text, w = 1200, h = 500, bg = 'e0f2f1') => `https://placehold.co/${w}x${h}/${bg}/0f172a?text=${encodeURIComponent(text)}`;

(async () => {
  await connectDB();
  await Promise.all([User.deleteMany({}), Category.deleteMany({}), Product.deleteMany({}), Campaign.deleteMany({}), Coupon.deleteMany({})]);
  await Setting.deleteMany({});
  await Setting.create({ key: 'site' });

  // Users (passwords are hashed by the model's pre-save hook)
  await User.create([
    { name: 'Site Admin', email: 'admin@hmart.com', password: 'Admin@123', role: 'admin' },
    { name: 'Mina Merchandiser', email: 'merch@hmart.com', password: 'Merch@123', role: 'merchandiser' },
    { name: 'Rahim Customer', email: 'customer@hmart.com', password: 'Customer@123', role: 'customer', phone: '01711111111' },
  ]);

  const cats = await Category.insertMany(
    ['Smart Phones', 'Headphones', 'Smart Watches', 'Speakers', 'Cameras', 'Accessories'].map((name) => ({
      name,
      slug: slugify(name),
      image: img(name),
    }))
  );
  const c = Object.fromEntries(cats.map((x) => [x.name, x._id]));

  const products = [
    ['Modern Smart Phone', 'Smart Phones', 38500, 34650, 25, 'Hmart', true],
    ['Bluetooth Headphone', 'Headphones', 4850, 3850, 60, 'SoundX', true],
    ['Smart Music Box', 'Speakers', 3850, null, 40, 'SoundX', false],
    ['Air Pods 25Hjkl Black', 'Headphones', 3850, null, 8, 'Hmart', false],
    ['Smart Hand Watch', 'Smart Watches', 3850, 3542, 30, 'Chrono', true],
    ['Smart Table Camera', 'Cameras', 13850, 11250, 12, 'Lens+', true],
    ['Round Pocket Router', 'Accessories', 3850, 3657, 50, 'NetGo', false],
    ['Power Bank 10000mAh', 'Accessories', 2600, 2385, 4, 'VoltX', true],
    ['Ladies Smart Watch', 'Smart Watches', 4850, 3850, 18, 'Chrono', true],
    ['Pro Gaming Headset', 'Headphones', 6500, null, 0, 'SoundX', false],
    ['Home Security Camera', 'Cameras', 7800, 6900, 22, 'Lens+', false],
    ['Fast Charger 65W', 'Accessories', 1800, null, 90, 'VoltX', false],
  ].map(([name, cat, price, sale, stock, brand, featured], i) => ({
    name,
    slug: slugify(name) + '-' + (i + 1),
    sku: 'HM-' + String(1000 + i),
    description: `${name} — a reliable smart device for your home. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
    category: c[cat],
    brand,
    price,
    salePrice: sale || undefined,
    images: [img(name), img(name + ' 2', 'e5e7eb'), img(name + ' 3', 'ede9fe')],
    tags: [cat.toLowerCase(), brand.toLowerCase(), 'smart'],
    stock,
    isFeatured: featured,
    rating: [4.5, 4, 5, 3.5, 4.5, 4, 3, 4.5, 5, 4, 4.5, 3.5][i],
    numReviews: 3 + i,
    sold: (i * 7) % 40,
  }));
  await Product.insertMany(products);

  await Campaign.insertMany([
    { title: 'Your Home Smart Devices & Best Solution', subtitle: 'Welcome To Hmart', placement: 'hero', image: banner('Smart Home Devices'), buttonText: 'Shop All Devices', link: '/shop', sortOrder: 1 },
    { title: 'Up To 30% Off Audio', subtitle: 'Headphones & Speakers', placement: 'hero', image: banner('Audio Sale', 1200, 500, 'ede9fe'), buttonText: 'Shop Audio', link: '/shop?category=headphones', sortOrder: 2 },
    { title: 'Smart Watch For Your Hand', priceText: 'From ৳2,900', placement: 'promo', image: banner('Smart Watch', 600, 300, 'fef3c7'), link: '/shop?category=smart-watches', sortOrder: 1 },
    { title: 'Headphones', priceText: 'From ৳3,850', placement: 'promo', image: banner('Headphones', 600, 300, 'dbeafe'), link: '/shop?category=headphones', sortOrder: 2 },
    { title: 'Smartphone', priceText: 'From ৳6,900', placement: 'promo', image: banner('Smartphone', 600, 300, 'fce7f3'), link: '/shop?category=smart-phones', sortOrder: 3 },
    { title: 'Bluetooth Headphone', subtitle: 'Featured Offer', placement: 'featured', image: banner('Bluetooth Headphone', 600, 600, 'e0f2f1'), priceText: '৳3,850', link: '/shop?category=headphones', sortOrder: 1, endsAt: new Date(Date.now() + 14 * 86400000) },
    { title: 'Ladies Smart Watch', subtitle: 'Featured Offer', placement: 'featured', image: banner('Ladies Smart Watch', 600, 600, 'fef3c7'), priceText: '৳3,850', link: '/shop?category=smart-watches', sortOrder: 2, endsAt: new Date(Date.now() + 7 * 86400000) },
  ]);

  await Coupon.insertMany([
    { code: 'WELCOME10', description: '10% off your first order', type: 'percent', value: 10, minOrder: 1000, maxDiscount: 1000 },
    { code: 'FLAT200', description: '৳200 off orders above ৳2,000', type: 'fixed', value: 200, minOrder: 2000 },
  ]);

  console.log('\nSeed complete. Demo logins:');
  console.log('  admin@hmart.com     / Admin@123');
  console.log('  merch@hmart.com     / Merch@123');
  console.log('  customer@hmart.com  / Customer@123\n');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
