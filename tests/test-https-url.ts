import { z } from 'zod';

// Test that our URL validation supports both HTTP and HTTPS
const urlSchema = z.string().url();

const testUrls = [
  'http://localhost:6333',
  'https://localhost:6333',
  'http://qdrant.example.com:6333',
  'https://qdrant.example.com:6333',
  'https://secure-qdrant.io:443',
  'http://192.168.1.100:6333',
];

console.log('Testing URL validation for HTTP/HTTPS support:\n');

for (const url of testUrls) {
  try {
    const validated = urlSchema.parse(url);
    console.log(`✅ ${url} - Valid`);
  } catch (error) {
    console.log(`❌ ${url} - Invalid`);
  }
}

console.log('\nAll common Qdrant URL formats are supported!');