export const EXPECTED_METADATA =
  '{"abi":2,"version":1,"magic":"PIXELS","rows":10,' +
  '"pixelStride":10000,"schemaCount":4,"rowGroupCount":1,' +
  '"firstColumn":{"name":"id","kind":4},' +
  '"postscript":{"contentLength":"352","compression":0,' +
  '"compressionBlockSize":1,' +
  '"writerTimezone":"Central European Standard Time",' +
  '"partitioned":false,"columnChunkAlignment":32,' +
  '"hasHiddenColumn":false},"schema":[' +
  '{"id":0,"name":"id","kind":4,"subtypes":[]},' +
  '{"id":1,"name":"name","kind":16,"subtypes":[],"maximumLength":25},' +
  '{"id":2,"name":"birthday","kind":15,"subtypes":[]},' +
  '{"id":3,"name":"score","kind":14,"subtypes":[],' +
  '"precision":15,"scale":2}],"fileStatistics":[' +
  '{"numberOfValues":"10","containsNull":false,' +
  '"integer":{"minimum":"0","maximum":"9","sum":"45"}},' +
  '{"numberOfValues":"10","containsNull":false,' +
  '"string":{"minimum":"Alice","maximum":"Tom","sum":"47"}},' +
  '{"numberOfValues":"10","containsNull":false,' +
  '"date":{"minimum":"-25202","maximum":"14389"}},' +
  '{"numberOfValues":"10","containsNull":false,' +
  '"integer":{"minimum":"740","maximum":"10001","sum":"66057"}}],' +
  '"rowGroups":[{"index":0,"footerOffset":"352","footerLength":154,' +
  '"dataLength":352,"rows":10}],"rowGroupStatistics":[[' +
  '{"numberOfValues":"10","containsNull":false,' +
  '"integer":{"minimum":"0","maximum":"9","sum":"45"}},' +
  '{"numberOfValues":"10","containsNull":false,' +
  '"string":{"minimum":"Alice","maximum":"Tom","sum":"47"}},' +
  '{"numberOfValues":"10","containsNull":false,' +
  '"date":{"minimum":"-25202","maximum":"14389"}},' +
  '{"numberOfValues":"10","containsNull":false,' +
  '"integer":{"minimum":"740","maximum":"10001","sum":"66057"}}]]}';

export const EXPECTED_ROW_GROUP =
  '{"rowGroup":0,"columns":[' +
  '{"column":0,"encoding":{"kind":0},"chunk":{"offset":"0",' +
  '"length":80,"nullOffset":80,"littleEndian":true,' +
  '"nullsPadding":false,"nullAlignment":0,"pixels":[{"index":0,' +
  '"position":0,"statistics":{"numberOfValues":"10",' +
  '"containsNull":false,"integer":{"minimum":"0","maximum":"9",' +
  '"sum":"45"}}}]}},' +
  '{"column":1,"encoding":{"kind":0},"chunk":{"offset":"96",' +
  '"length":95,"nullOffset":47,"littleEndian":true,' +
  '"nullsPadding":false,"nullAlignment":0,"pixels":[{"index":0,' +
  '"position":0,"statistics":{"numberOfValues":"10",' +
  '"containsNull":false,"string":{"minimum":"Alice","maximum":"Tom",' +
  '"sum":"47"}}}]}},' +
  '{"column":2,"encoding":{"kind":0},"chunk":{"offset":"192",' +
  '"length":40,"nullOffset":40,"littleEndian":true,' +
  '"nullsPadding":false,"nullAlignment":0,"pixels":[{"index":0,' +
  '"position":0,"statistics":{"numberOfValues":"10",' +
  '"containsNull":false,"date":{"minimum":"-25202",' +
  '"maximum":"14389"}}}]}},' +
  '{"column":3,"encoding":{"kind":0},"chunk":{"offset":"256",' +
  '"length":80,"nullOffset":80,"littleEndian":true,' +
  '"nullsPadding":false,"nullAlignment":0,"pixels":[{"index":0,' +
  '"position":0,"statistics":{"numberOfValues":"10",' +
  '"containsNull":false,"integer":{"minimum":"740","maximum":"10001",' +
  '"sum":"66057"}}}]}}]}';

export const EXPECTED_PAGE =
  '{"rowGroup":0,"column":0,"offset":0,"count":10,' +
  '"values":["0","1","2","3","4","5","6","7","8","9"]}';
