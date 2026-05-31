const MAX_PRODUCT_IMAGES = 4;

function sanitizeProductImage(value) {
  const image = String(value || '').trim();
  if (!image || image.length > 500) return '';
  if (/[\s"'()<>\\{};]/.test(image)) return '';
  if (image.startsWith('/assets/') || image.startsWith('/uploads/')) return image;

  try {
    const parsed = new URL(image);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch (err) {
    return '';
  }

  return '';
}

function normalizeProductImages(input) {
  let values = [];

  if (Array.isArray(input)) {
    values = input;
  } else if (input && typeof input === 'object') {
    values = Object.values(input);
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      values = Array.isArray(parsed) ? parsed : [trimmed];
    } catch (err) {
      values = trimmed.split(/\r?\n|,/);
    }
  }

  const seen = new Set();
  return values
    .map(sanitizeProductImage)
    .filter(Boolean)
    .filter(image => {
      if (seen.has(image)) return false;
      seen.add(image);
      return true;
    })
    .slice(0, MAX_PRODUCT_IMAGES);
}

function productImagesFromBody(body = {}) {
  const fieldImages = [body.image_1, body.image_2, body.image_3, body.image_4];
  const payloadImages = body.images !== undefined ? body.images : body.image_urls;
  return normalizeProductImages(fieldImages.some(Boolean) ? fieldImages : payloadImages);
}

function stringifyProductImages(images) {
  const normalized = normalizeProductImages(images);
  return normalized.length ? JSON.stringify(normalized) : null;
}

function hasProductImagePayload(body = {}) {
  return ['images', 'image_urls', 'image_1', 'image_2', 'image_3', 'image_4']
    .some(key => Object.prototype.hasOwnProperty.call(body, key));
}

function attachProductImages(product, fallbackImage) {
  if (!product) return product;
  const images = normalizeProductImages(product.image_urls);
  return {
    ...product,
    images,
    image: images[0] || fallbackImage || product.image,
  };
}

module.exports = {
  MAX_PRODUCT_IMAGES,
  attachProductImages,
  hasProductImagePayload,
  normalizeProductImages,
  productImagesFromBody,
  stringifyProductImages,
};
