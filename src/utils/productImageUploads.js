const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const { normalizeProductImages, productImagesFromBody } = require('./productImages');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'products');
const publicUploadPath = '/uploads/products/';

function ensureUploadDir() {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function isMultipart(req) {
  return String(req.headers['content-type'] || '').toLowerCase().includes('multipart/form-data');
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function flattenFields(fields) {
  return Object.entries(fields || {}).reduce((flat, [key, value]) => {
    flat[key] = firstValue(value);
    return flat;
  }, {});
}

function firstUploadedFile(value) {
  const file = firstValue(value);
  if (!file || Number(file.size || 0) <= 0) return null;
  return file;
}

function uploadedFilePath(file) {
  const filepath = file && (file.filepath || file.path);
  if (!filepath) return '';
  return `${publicUploadPath}${path.basename(filepath)}`;
}

function imageUrlsFromUpload(fields, files) {
  const images = [1, 2, 3, 4].map(index => {
    const uploaded = firstUploadedFile(files[`image_${index}_file`]);
    if (uploaded) return uploadedFilePath(uploaded);
    return fields[`existing_image_${index}`] || '';
  });

  return normalizeProductImages(images);
}

function parseMultipartProductForm(req) {
  ensureUploadDir();

  const form = formidable({
    uploadDir,
    keepExtensions: true,
    multiples: false,
    maxFiles: 4,
    maxFileSize: 5 * 1024 * 1024,
    filter(part) {
      if (!String(part.name || '').endsWith('_file')) return true;
      return String(part.mimetype || '').startsWith('image/');
    },
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);

      const flatFields = flattenFields(fields);
      resolve({
        fields: flatFields,
        images: imageUrlsFromUpload(flatFields, files || {}),
      });
    });
  });
}

async function parseProductForm(req) {
  if (!isMultipart(req)) {
    return {
      fields: req.body || {},
      images: productImagesFromBody(req.body || {}),
    };
  }

  return parseMultipartProductForm(req);
}

module.exports = {
  parseProductForm,
};
