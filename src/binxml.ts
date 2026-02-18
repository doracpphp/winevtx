import {
  ParseContext,
  TemplateNode,
  debug,
  utf16leToUtf8,
  filetimeToUnixtime,
  formatGUID,
  readName,
  readPrefixedUnicodeString,
} from "./parse-context.js";

function parseOpenStartElement(
  ctx: ParseContext,
  hasAttr: boolean,
  templateInstance: boolean
): boolean {
  debug("ParseOpenStartElement Enter: %x", ctx.getOffset());

  if (templateInstance) {
    ctx.skipBytes(2);
  }

  const elementLength = ctx.consumeUint32();
  debug("ParseOpenStartElement elementLength: %x", elementLength);

  const nameBuffer = readName(ctx);

  let attributeListLength = 0;
  if (hasAttr) {
    attributeListLength = ctx.consumeUint32();
  }

  debug(
    "Start element %s with %d attributes",
    nameBuffer,
    attributeListLength
  );
  debug("ParseOpenStartElement Exit: %x", ctx.getOffset());

  const newTemplate = new TemplateNode();
  ctx.pushTemplate(nameBuffer, newTemplate);

  return true;
}

function parseCloseStartElement(ctx: ParseContext): boolean {
  debug("ParseCloseStartElement %x", ctx.getOffset());
  ctx.attributeMode = false;
  ctx.currentTemplate().currentKey = "";
  return true;
}

function parseCloseElement(ctx: ParseContext): boolean {
  debug("ParseCloseElement %x", ctx.getOffset());
  ctx.popTemplate();
  return true;
}

function parseValueText(ctx: ParseContext): boolean {
  debug("ParseValueText %x", ctx.getOffset());
  const stringType = ctx.consumeUint8();
  const stringValue = readPrefixedUnicodeString(ctx, false);

  debug("ParseValueText Value is %s (type %d)", stringValue, stringType);
  debug("Current Key %s", ctx.currentKey());

  const key = ctx.currentKey();
  ctx.currentTemplate().setLiteral(key, stringValue);
  ctx.attributeMode = false;

  return true;
}

function parseAttributes(ctx: ParseContext): boolean {
  debug("ParseAttributes %x", ctx.getOffset());
  const attribute = readName(ctx);

  debug("Attribute is %s", attribute);
  ctx.currentTemplate().currentKey = attribute;
  ctx.attributeMode = true;

  return true;
}

function parseTemplateInstance(ctx: ParseContext): boolean {
  debug("ParseTemplateInstance Enter %x", ctx.getOffset());
  if (ctx.consumeUint8() !== 0x01) {
    return false;
  }

  const shortId = ctx.consumeUint32();
  if (shortId === 0) {
    return false;
  }

  const templateDefinitionData = ctx.consumeUint32();
  debug(
    "ParseTemplateInstance template_definition_data %x",
    templateDefinitionData
  );

  let numArguments = ctx.consumeUint32();
  if (numArguments > 1024 * 10) {
    numArguments = 10 * 1024;
  }

  debug("template id %x", shortId);

  let template = ctx.getTemplateByID(shortId);
  if (template === undefined) {
    ctx.skipBytes(16); // longGUID
    const templateBodyLen = ctx.consumeUint32();

    const tmpCtx = ctx.copy();
    template = tmpCtx.newTemplate(shortId);
    parseBinXML(tmpCtx, true);

    ctx.skipBytes(templateBodyLen);
    numArguments = ctx.consumeUint32();
  }

  debug(
    "ParseTemplateInstance Parse %x args @ %x",
    numArguments,
    ctx.getOffset()
  );

  interface ArgDetail {
    argLen: number;
    argType: number;
  }

  const args: ArgDetail[] = [];
  for (let i = 0; i < numArguments; i++) {
    const argLen = ctx.consumeUint16();
    const argType = ctx.consumeUint16();
    args.push({ argLen, argType });
  }

  const argValues = new Map<number, unknown>();

  for (let idx = 0; idx < args.length; idx++) {
    const arg = args[idx];
    switch (arg.argType) {
      case 0x00:
        ctx.skipBytes(arg.argLen);
        break;

      case 0x01: // String
        argValues.set(idx, utf16leToUtf8(ctx.consumeBytes(arg.argLen)));
        break;

      case 0x04: // uint8
        argValues.set(idx, ctx.consumeUint8());
        break;

      case 0x06: // uint16
        argValues.set(idx, ctx.consumeUint16());
        break;

      case 0x07: // int32
        argValues.set(idx, ctx.consumeInt32());
        break;

      case 0x08: // uint32
        argValues.set(idx, ctx.consumeUint32());
        break;

      case 0x09: // int64
        argValues.set(idx, ctx.consumeInt64());
        break;

      case 0x0a: // uint64
        argValues.set(idx, ctx.consumeUint64());
        break;

      case 0x0b: // real32
        argValues.set(idx, ctx.consumeReal32());
        break;

      case 0x0c: // real64
        argValues.set(idx, ctx.consumeReal64());
        break;

      case 0x0d: {
        // bool
        let value = false;
        switch (arg.argLen) {
          case 8:
            value = ctx.consumeUint64() > 0n;
            break;
          case 4:
            value = ctx.consumeUint32() > 0;
            break;
          case 2:
            value = ctx.consumeUint16() > 0;
            break;
          case 1:
            value = ctx.consumeUint8() > 0;
            break;
        }
        argValues.set(idx, value);
        break;
      }

      case 0x0e: // binary
        argValues.set(idx, ctx.consumeBytes(arg.argLen));
        break;

      case 0x0f: // GUID
        argValues.set(idx, formatGUID(ctx.consumeBytes(arg.argLen)));
        break;

      case 0x14: // HexInt32
        argValues.set(idx, ctx.consumeUint32());
        break;

      case 0x15: // HexInt64
        argValues.set(idx, ctx.consumeUint64());
        break;

      case 0x11: // FileTime
        argValues.set(idx, filetimeToUnixtime(ctx.consumeUint64()));
        break;

      case 0x12: // SysTime
        argValues.set(idx, ctx.consumeSysTime(arg.argLen));
        break;

      case 0x13: {
        // SID
        let str = "S";
        str += `-${ctx.consumeUint8()}`;
        ctx.consumeUint8();
        const authBytes = ctx.consumeBytes(6);
        let vq = 0n;
        for (let b = 0; b < 6; b++) {
          vq = (vq << 8n) | BigInt(authBytes[b]);
        }
        str += `-${vq}`;
        for (let i = 0; i < arg.argLen - 8; i += 4) {
          str += `-${ctx.consumeUint32()}`;
        }
        argValues.set(idx, str);
        break;
      }

      case 0x21: {
        // BinXml
        const newCtx = ctx.copy();
        parseBinXML(newCtx, false);
        ctx.skipBytes(arg.argLen);
        argValues.set(idx, newCtx.currentTemplate().expand(null));
        break;
      }

      case 0x27:
      case 0x28:
        argValues.set(idx, ctx.consumeBytes(arg.argLen).toString());
        break;

      case 0x81: {
        // List of UTF16 strings
        const raw = utf16leToUtf8(ctx.consumeBytes(arg.argLen));
        argValues.set(idx, raw.split("\x00"));
        break;
      }

      case 0x86: // Array of uint16
        argValues.set(idx, ctx.consumeUint16Array(arg.argLen));
        break;

      case 0x8a: // Array of uint64
        argValues.set(idx, ctx.consumeUint64Array(arg.argLen));
        break;

      case 0x95: // Array of int64 hex
        argValues.set(idx, ctx.consumeInt64HexArray(arg.argLen));
        break;

      default: {
        const unknown = ctx.consumeBytes(arg.argLen);
        debug("I dont know how to handle type %x (%d bytes)", arg.argType, arg.argLen);
        argValues.set(
          idx,
          unknown.toString().replace(/\x00+$/, "")
        );
        break;
      }
    }

    debug(
      "%d Arg type %x len %x - %s",
      idx,
      arg.argType,
      arg.argLen,
      String(argValues.get(idx))
    );
  }

  debug("ParseTemplateInstance Exit %x", ctx.offset);
  const expanded = template.expand(argValues);

  normalizeEventData(expanded);
  ctx.currentTemplate().setLiteral(ctx.currentKey(), expanded);

  return true;
}

function parseOptionalSubstitution(ctx: ParseContext): boolean {
  debug("ParseOptionalSubstitution Enter %x", ctx.getOffset());
  const substitutionID = ctx.consumeUint16();
  let valueType = ctx.consumeUint8();
  if (valueType === 0) {
    valueType = ctx.consumeUint8();
  }

  debug("CurrentKey %s", ctx.currentKey());
  debug(
    "ParseOptionalSubstitution Exit @%x  %x (%x)",
    ctx.getOffset(),
    substitutionID,
    valueType
  );

  const key = ctx.currentKey();
  ctx.currentTemplate().setExpansion(key, substitutionID, valueType);

  return true;
}

export function parseBinXML(
  ctx: ParseContext,
  templateContext: boolean
): void {
  debug("ParseBinXML");
  let keepGoing = true;

  while (keepGoing) {
    const tag = ctx.consumeUint8();
    debug("Tag %x @ %x", tag, ctx.getOffset());

    switch (tag) {
      case 0x00: // EOF
        keepGoing = false;
        break;

      case 0x01: // OpenStartElementToken
        keepGoing = parseOpenStartElement(ctx, false, templateContext);
        break;
      case 0x41:
        keepGoing = parseOpenStartElement(ctx, true, templateContext);
        break;

      case 0x02: // CloseStartElementToken
        keepGoing = parseCloseStartElement(ctx);
        break;

      case 0x03: // CloseEmptyElementToken
      case 0x04: // CloseElementToken
        keepGoing = parseCloseElement(ctx);
        break;

      case 0x05: // ValueTextToken
      case 0x45:
        keepGoing = parseValueText(ctx);
        break;

      case 0x06: // AttributeToken
      case 0x46:
        keepGoing = parseAttributes(ctx);
        break;

      case 0x07: // CDATASectionToken
      case 0x47:
      case 0x08: // CharRefToken
      case 0x48:
      case 0x09: // EntityRefToken
      case 0x49:
      case 0x0a: // PITargetToken
      case 0x0b: // PIDataToken
        break;

      case 0x0c: // TemplateInstanceToken
        keepGoing = parseTemplateInstance(ctx);
        break;

      case 0x0d: // NormalSubstitutionToken
      case 0x0e: // OptionalSubstitutionToken
        keepGoing = parseOptionalSubstitution(ctx);
        break;

      case 0x0f: // FragmentHeaderToken
        ctx.skipBytes(3);
        break;

      default:
        keepGoing = false;
        break;
    }
  }
}

/**
 * Normalize EventData from array-of-named-Data form into a flat dict.
 * Mutates the expanded Map in place.
 */
function normalizeEventData(expanded: unknown): void {
  if (!(expanded instanceof Map)) return;

  const eventData = expanded.get("EventData");
  if (!(eventData instanceof Map)) return;

  const dataTag = eventData.get("Data");
  if (!Array.isArray(dataTag)) return;

  const result = new Map<string, unknown>();
  for (const item of dataTag) {
    if (!(item instanceof Map)) return;

    const name = item.get("Name");
    if (typeof name !== "string") return;

    const value = item.get("Value");
    if (value === undefined) return;

    result.set(name, value);
  }

  expanded.set("EventData", result);
}
