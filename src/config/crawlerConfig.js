// src/config/crawlerConfig.js
//
// Cấu hình Crawler cho YBOX
// study_level values must match scholarships.study_levels API: bachelor/master/doctoral/other.
// Mỗi nguồn = 1 object

const REGION = {
  ASIA: { continent: "Châu Á", country: null },
};

const COMMON_YBOX_CONFIG = {
  sourceName: "YBOX",
  baseUrl: "https://ybox.vn",
  steps: [
    {
      type: "waitForSelector",
      selector: ".post--article",
      label: "Đợi danh sách bài viết tải xong",
      waitAfter: 1000,
    },
  ],
  selectors: {
    // Cào ở trang danh sách
    item: ".post--article",
    title: "h2.post-title a",
    link: "h2.post-title a",
    deadline: ".due-date span",
    // Cào ở trang chi tiết
    detailContent: "#post-content",
  },
};

const crawlConfigs = [
  {
    ...COMMON_YBOX_CONFIG,
    key: "ybox-bachelor",
    enabled: true,
    sourceUrl:
      "https://ybox.vn/hoc-bong-du-hoc-tai-chau-a-singapore-nhat-ban-han-quoc-cu-nhan-tk-c2t3g1",
    defaults: { ...REGION.ASIA, study_level: "bachelor" },
    maxItems: 10,
  },
  {
    ...COMMON_YBOX_CONFIG,
    key: "ybox-master",
    enabled: true,
    sourceUrl:
      "https://ybox.vn/hoc-bong-du-hoc-tai-chau-a-singapore-nhat-ban-han-quoc-thac-si-tk-c2t3g2",
    defaults: { ...REGION.ASIA, study_level: "master" },
    maxItems: 10,
  },
  {
    ...COMMON_YBOX_CONFIG,
    key: "ybox-phd",
    enabled: true,
    sourceUrl:
      "https://ybox.vn/hoc-bong-du-hoc-tai-chau-a-singapore-nhat-ban-han-quoc-tien-si-nghien-cuu-sinh-tk-c2t3g3",
    defaults: { ...REGION.ASIA, study_level: "doctoral" },
    maxItems: 10,
  },
  {
    ...COMMON_YBOX_CONFIG,
    key: "ybox-exchange",
    enabled: true,
    sourceUrl:
      "https://ybox.vn/hoc-bong-du-hoc-tai-chau-a-singapore-nhat-ban-han-quoc-trao-doi-ngan-han-and-giao-luu-van-hoa-tk-c2t3g5",
    defaults: { ...REGION.ASIA, study_level: "other" },
    maxItems: 10,
  },
];

module.exports = crawlConfigs;
