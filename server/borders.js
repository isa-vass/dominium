const borders = {
    "province-1":  ["province-2", "province-3", "province-10"],
    "province-2":  ["province-1", "province-3", "province-9", "province-4"],
    "province-3":  ["province-4", "province-1", "province-2", "province-7", "province-8", "province-13"],
    "province-4":  ["province-2", "province-3", "province-6", "province-7"],
    "province-5":  ["province-14", "province-8", "province-7"],
    "province-6":  ["province-4", "province-7"],
    "province-7":  ["province-4", "province-5", "province-6", "province-8", "province-3"],
    "province-8":  ["province-3", "province-7", "province-5", "province-11"],
    "province-9":  ["province-2", "province-12", "province-10", "province-11"],
    "province-10": ["province-1", "province-11", "province-9"],
    "province-11": ["province-10", "province-12", "province-9", "province-8", "province-13", "province-14", "province-16"],
    "province-12": ["province-9", "province-11", "province-15", "province-16"],
    "province-13": ["province-3", "province-11", "province-14"],
    "province-14": ["province-5","province-11", "province-13", "province-14", "province-16"],
    "province-15": ["province-12", "province-16"],
    "province-16": ["province-12", "province-14", "province-15", "province-11"]
};

module.exports = borders;