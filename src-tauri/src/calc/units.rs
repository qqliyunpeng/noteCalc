//! Unit table and conversion rules, ported from `calculator_core.py`.

use std::collections::HashMap;
use std::sync::OnceLock;

pub enum Conversion {
    Scale(f64),
    Custom(fn(f64) -> f64, fn(f64) -> f64),
}

pub struct UnitDefinition {
    pub name: &'static str,
    pub aliases: &'static [&'static str],
    pub category: &'static str,
    pub conversion: Conversion,
}

impl UnitDefinition {
    pub fn to_base(&self, value: f64) -> f64 {
        match self.conversion {
            Conversion::Scale(factor) => value * factor,
            Conversion::Custom(to_base, _) => to_base(value),
        }
    }

    pub fn from_base(&self, value: f64) -> f64 {
        match self.conversion {
            Conversion::Scale(factor) => value / factor,
            Conversion::Custom(_, from_base) => from_base(value),
        }
    }
}

fn scale(
    name: &'static str,
    aliases: &'static [&'static str],
    category: &'static str,
    factor: f64,
) -> UnitDefinition {
    UnitDefinition {
        name,
        aliases,
        category,
        conversion: Conversion::Scale(factor),
    }
}

fn celsius_to_base(value: f64) -> f64 {
    value
}

fn celsius_from_base(value: f64) -> f64 {
    value
}

fn fahrenheit_to_base(value: f64) -> f64 {
    (value - 32.0) * 5.0 / 9.0
}

fn fahrenheit_from_base(value: f64) -> f64 {
    value * 9.0 / 5.0 + 32.0
}

fn kelvin_to_base(value: f64) -> f64 {
    value - 273.15
}

fn kelvin_from_base(value: f64) -> f64 {
    value + 273.15
}

fn build_units() -> Vec<UnitDefinition> {
    vec![
        scale("mm", &["millimeter", "millimeters"], "length", 0.001),
        scale("cm", &["centimeter", "centimeters"], "length", 0.01),
        scale("dm", &["decimeter", "decimeters"], "length", 0.1),
        scale("m", &["meter", "meters"], "length", 1.0),
        scale("km", &["kilometer", "kilometers"], "length", 1000.0),
        scale("inch", &["in", "inches"], "length", 0.0254),
        scale("ft", &["feet", "foot"], "length", 0.3048),
        scale("yd", &["yard", "yards"], "length", 0.9144),
        scale("mi", &["mile", "miles"], "length", 1609.344),
        scale("里", &["li"], "length", 500.0),
        scale("丈", &["zhang"], "length", 10.0 / 3.0),
        scale("尺", &["chi"], "length", 1.0 / 3.0),
        scale("寸", &["cun"], "length", 1.0 / 30.0),
        scale("mg", &["milligram", "milligrams"], "mass", 0.000001),
        scale("g", &["gram", "grams"], "mass", 0.001),
        scale("kg", &["kilogram", "kilograms"], "mass", 1.0),
        scale("t", &["ton", "tons", "tonne", "tonnes"], "mass", 1000.0),
        scale("lb", &["pound", "pounds"], "mass", 0.453592),
        scale("oz", &["ounce", "ounces"], "mass", 0.0283495),
        scale("斤", &["jin"], "mass", 0.5),
        scale("两", &["liang"], "mass", 0.05),
        scale("mm2", &["mm²"], "area", 0.000001),
        scale("cm2", &["cm²"], "area", 0.0001),
        scale("m2", &["m²"], "area", 1.0),
        scale("km2", &["km²"], "area", 1000000.0),
        scale("acre", &["acres"], "area", 4046.86),
        scale("ha", &["hectare", "hectares"], "area", 10000.0),
        scale("ml", &["milliliter", "milliliters", "mL"], "volume", 0.001),
        scale(
            "L",
            &["l", "liter", "liters", "litre", "litres"],
            "volume",
            1.0,
        ),
        scale("gallon", &["gal", "gallons"], "volume", 3.78541),
        scale("cup", &["cups"], "volume", 0.236588),
        UnitDefinition {
            name: "°C",
            aliases: &["celsius", "C", "degC"],
            category: "temperature",
            conversion: Conversion::Custom(celsius_to_base, celsius_from_base),
        },
        UnitDefinition {
            name: "°F",
            aliases: &["fahrenheit", "F", "degF"],
            category: "temperature",
            conversion: Conversion::Custom(fahrenheit_to_base, fahrenheit_from_base),
        },
        UnitDefinition {
            name: "K",
            aliases: &["kelvin"],
            category: "temperature",
            conversion: Conversion::Custom(kelvin_to_base, kelvin_from_base),
        },
        scale("ms", &["millisecond", "milliseconds"], "time", 0.001),
        scale("s", &["sec", "second", "seconds"], "time", 1.0),
        scale("min", &["minute", "minutes"], "time", 60.0),
        scale("h", &["hr", "hour", "hours"], "time", 3600.0),
        scale("day", &["days"], "time", 86400.0),
    ]
}

pub fn units() -> &'static [UnitDefinition] {
    static UNITS: OnceLock<Vec<UnitDefinition>> = OnceLock::new();
    UNITS.get_or_init(build_units).as_slice()
}

fn lookup() -> &'static HashMap<String, &'static UnitDefinition> {
    static LOOKUP: OnceLock<HashMap<String, &'static UnitDefinition>> = OnceLock::new();
    LOOKUP.get_or_init(|| {
        let mut table: HashMap<String, &'static UnitDefinition> = HashMap::new();
        for definition in units() {
            table.insert(definition.name.to_lowercase(), definition);
            for alias in definition.aliases {
                table.insert(alias.to_lowercase(), definition);
            }
        }
        table
    })
}

pub fn find_unit(name: &str) -> Option<&'static UnitDefinition> {
    lookup().get(&name.to_lowercase()).copied()
}

pub fn unit_names() -> Vec<String> {
    lookup().keys().cloned().collect()
}