import { PrismaClient } from '@prisma/client';

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

async function main() {
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
}

main()
  .then(() => {
    console.log('Seed category thành công.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
