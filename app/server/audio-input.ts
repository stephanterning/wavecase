const formats = "wav,aiff,flac,mp3,mov,matroska,ogg,aac,asf,ape,wv,au,caf";
export const audioInput = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  formats,
];
