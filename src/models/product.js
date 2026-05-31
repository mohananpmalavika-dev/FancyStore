class Product {
  constructor({ id, name, category, price, stock, description }) {
    this.id = id;
    this.name = name;
    this.category = category;
    this.price = price;
    this.stock = stock;
    this.description = description;
  }
}

module.exports = Product;
