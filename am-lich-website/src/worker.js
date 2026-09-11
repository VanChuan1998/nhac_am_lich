export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Danh sách các route không có đuôi .html cần được rewrite
    const extensionlessRoutes = [
      '/privacy',
      '/privacy-vi',
      '/terms',
      '/terms-vi',
      '/app',
      '/vi'
    ];

    if (extensionlessRoutes.includes(path)) {
      url.pathname = path + '.html';
      return env.ASSETS.fetch(new Request(url, request));
    }
    
    return env.ASSETS.fetch(request);
  }
};
