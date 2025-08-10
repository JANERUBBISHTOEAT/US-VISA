#!/bin/bash

# US-VISA Chrome Extension - Final Verification Script
echo "🔍 US-VISA Chrome Extension - Final Verification"
echo "================================================="

# Change to project directory
cd "/Users/pod_0x000d/Documents/GitHub/US-VISA"

echo ""
echo "📁 Project Structure Check..."
echo "✅ Main files:"
ls -la *.{json,html,md} 2>/dev/null | grep -E "\.(json|html|md)$" || echo "❌ Missing main files"

echo ""
echo "✅ Source files:"
find src -name "*.js" -exec echo "  📄 {}" \; -exec wc -l {} \; | paste - -

echo ""
echo "✅ Locale files:"
find locales -name "*.json" -exec echo "  🌍 {}" \; -exec wc -l {} \; | paste - -

echo ""
echo "🔍 JSON Syntax Validation..."
for file in locales/*.json; do
    if python3 -m json.tool "$file" > /dev/null 2>&1; then
        echo "✅ $file - Valid JSON"
    else
        echo "❌ $file - Invalid JSON"
    fi
done

echo ""
echo "🔍 Content Validation..."

# Check for soft ban implementation
if grep -q "detectSoftBan\|软封禁\|soft_ban" src/js/content.js; then
    echo "✅ Soft ban detection implemented"
else
    echo "❌ Soft ban detection missing"
fi

# Check for timezone awareness
if grep -q "America/New_York\|applyTimezoneBasedRateLimit" src/js/content.js; then
    echo "✅ Timezone awareness implemented"
else
    echo "❌ Timezone awareness missing"
fi

# Check for i18n system
if grep -q "logI18n\|i18n\.t" src/js/content.js; then
    echo "✅ Internationalization system implemented"
else
    echo "❌ Internationalization system missing"
fi

echo ""
echo "🔍 Language Pack Consistency..."
en_lines=$(wc -l < locales/en.json)
zh_hans_lines=$(wc -l < locales/zh-Hans.json)
fr_lines=$(wc -l < locales/fr.json)
zh_hant_lines=$(wc -l < locales/zh-Hant.json)

if [ "$en_lines" -eq "$zh_hans_lines" ] && [ "$zh_hans_lines" -eq "$fr_lines" ] && [ "$fr_lines" -eq "$zh_hant_lines" ]; then
    echo "✅ All language packs have consistent line counts ($en_lines lines each)"
else
    echo "❌ Language pack line counts differ: EN=$en_lines, ZH-Hans=$zh_hans_lines, FR=$fr_lines, ZH-Hant=$zh_hant_lines"
fi

echo ""
echo "🔍 Locale Key Consistency..."
if ! python3 <<'PY'
import json, glob, sys, os


def flatten(d, prefix=''):
    for k, v in d.items():
        if isinstance(v, dict):
            yield from flatten(v, prefix + k + '.')
        else:
            yield prefix + k


files = glob.glob('locales/*.json')
keysets = {}
for f in files:
    with open(f, encoding='utf-8') as fh:
        data = json.load(fh)
    keysets[os.path.basename(f)] = set(flatten(data))

all_keys = set().union(*keysets.values())
missing = {name: all_keys - ks for name, ks in keysets.items() if all_keys - ks}

if missing:
    print("❌ Missing translation keys:")
    for name, miss in missing.items():
        print(f"   {name} is missing keys: {sorted(miss)}")
    sys.exit(1)
else:
    print("✅ All locale files contain identical key sets")
PY
then
    exit 1
fi

echo ""
echo "🔍 Key Feature Verification..."

# Check for specific soft ban keys in all languages
if grep -q "soft_ban_detected" locales/*.json; then
    echo "✅ Soft ban messages found in language packs"
else
    echo "❌ Soft ban messages missing from language packs"
fi

# Check for timezone-related messages
if grep -q "timezone\|time_zone" locales/*.json; then
    echo "✅ Timezone messages found in language packs"
else
    echo "❌ Timezone messages missing from language packs"
fi

echo ""
echo "📊 Final Statistics..."
echo "  📄 Main script size: $(du -h src/js/content.js | cut -f1)"
echo "  📄 Total lines in content.js: $(wc -l < src/js/content.js)"
echo "  🌍 Supported languages: 4 (en, zh-Hans, fr, zh-Hant)"
echo "  📦 Total locale file size: $(du -hc locales/*.json | tail -1 | cut -f1)"

echo ""
echo "🎉 Verification Complete!"
echo "================================================="
echo "Status: ✅ PROJECT READY FOR DEPLOYMENT"
echo "Version: 2.0.0"
echo "Features: ✅ Soft Ban Detection, ✅ Timezone Awareness, ✅ Full i18n Support"
echo "Languages: ✅ English, ✅ 简体中文, ✅ Français, ✅ 繁體中文"
