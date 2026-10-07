import { PrismaClient } from '@prisma/client';
import { readSeedAdminConfig, seedAdmin } from './seed-admin';

const prisma = new PrismaClient();

type CategorySeed = {
  name: string;
  slug: string;
  children: { name: string; slug: string }[];
};

// Danh mục mẫu 2 cấp, đủ đa ngành hàng để Product (Bước 2) có category thật
// tham chiếu tới — chưa có CRUD category cho Seller/Admin ở Tuần 4 (ngoài
// phạm vi roadmap), chỉ seed tay.
const categories: CategorySeed[] = [
  {
    name: 'Thời trang',
    slug: 'thoi-trang',
    children: [
      { name: 'Áo nam', slug: 'ao-nam' },
      { name: 'Áo nữ', slug: 'ao-nu' },
    ],
  },
  {
    name: 'Điện tử',
    slug: 'dien-tu',
    children: [
      { name: 'Điện thoại', slug: 'dien-thoai' },
      { name: 'Laptop', slug: 'laptop' },
    ],
  },
  {
    name: 'Gia dụng',
    slug: 'gia-dung',
    children: [
      { name: 'Đồ dùng nhà bếp', slug: 'do-dung-nha-bep' },
      { name: 'Nội thất', slug: 'noi-that' },
    ],
  },
];

type PlatformVoucherSeed = {
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  minOrderAmount: number;
  maxDiscountAmount?: number;
};

// Voucher toàn sàn (shopId = null) mẫu — chưa có Admin UI tạo voucher (Tuần
// 11), Seller chỉ tạo được voucher theo shop của mình (Week6.md 1.14). Mã viết
// HOA để khớp cách VoucherService.validate chuẩn hoá. Không giới hạn lượt
// dùng/hạn dùng để dùng test tay thoải mái.
const platformVouchers: PlatformVoucherSeed[] = [
  {
    code: 'CHAOMUNG10',
    type: 'PERCENT',
    value: 10,
    minOrderAmount: 200000,
    maxDiscountAmount: 50000,
  },
  { code: 'GIAM50K', type: 'FIXED', value: 50000, minOrderAmount: 300000 },
];

async function main() {
  // Đọc cấu hình admin TRƯỚC khi ghi bất kỳ thứ gì: ENV khai sai thì dừng ngay, không seed dở dang.
  const adminConfig = readSeedAdminConfig(process.env);

  // update: {} — chạy lại seed không ghi đè usedCount/isActive đã đổi tay, chỉ
  // tạo thêm mã còn thiếu.
  for (const voucher of platformVouchers) {
    await prisma.voucher.upsert({
      where: { code: voucher.code },
      update: {},
      create: { shopId: null, ...voucher },
    });
  }

  for (const parent of categories) {
    const parentRecord = await prisma.category.upsert({
      where: { slug: parent.slug },
      update: { name: parent.name },
      create: { name: parent.name, slug: parent.slug },
    });

    for (const child of parent.children) {
      await prisma.category.upsert({
        where: { slug: child.slug },
        update: { name: child.name, parentId: parentRecord.id },
        create: {
          name: child.name,
          slug: child.slug,
          parentId: parentRecord.id,
        },
      });
    }
  }

  if (adminConfig) {
    const result = await seedAdmin(prisma, adminConfig);
    console.log(`Seed tài khoản ADMIN (${adminConfig.email}): ${result}.`);
  } else {
    console.log(
      'Bỏ qua seed ADMIN (chưa khai SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD).',
    );
  }
}

main()
  .then(() => {
    console.log('Seed category và voucher toàn sàn thành công.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
