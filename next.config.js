/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server actions are enabled by default in Next.js 15
  // Allow importing from src directory
  transpilePackages: [],
  // Webpack config to handle .js imports in TypeScript and ES modules
  webpack: (config, { isServer }) => {
    // Handle ES module imports - allow .js extension to resolve to .ts files
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    
    // Ensure proper module resolution for server-side code
    if (isServer) {
      // Don't externalize our src modules - we need to bundle them
      config.externals = config.externals || [];
      
      // Add fallback for Node.js built-ins if needed
      config.resolve.fallback = {
        ...config.resolve.fallback,
      };
    }
    
    return config;
  },
  // Experimental features for better ES module support
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;

