function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Service Repair Tracking')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}