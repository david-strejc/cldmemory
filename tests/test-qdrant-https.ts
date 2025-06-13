import { QdrantClient } from '@qdrant/js-client-rest';

// Test various URL formats and their parsed results
const testUrls = [
  'http://localhost:6333',
  'https://localhost:6333',
  'https://memory.apertia.ai',
  'https://memory.apertia.ai:443',
  'https://qdrant.example.com:8443',
];

console.log('Testing Qdrant client configuration with different URLs:\n');

for (const testUrl of testUrls) {
  console.log(`Testing URL: ${testUrl}`);
  
  // Parse the URL
  const url = new URL(testUrl);
  const isHttps = url.protocol === 'https:';
  const defaultPort = isHttps ? 443 : 6333;
  const port = url.port ? parseInt(url.port) : defaultPort;
  
  console.log(`  Protocol: ${url.protocol}`);
  console.log(`  Host: ${url.hostname}`);
  console.log(`  Port: ${port}`);
  console.log(`  HTTPS: ${isHttps}`);
  
  // Show how it would be configured
  const config = {
    host: url.hostname,
    port: port,
    https: isHttps,
    apiKey: 'test-key',
  };
  
  console.log(`  Config:`, config);
  console.log('');
}