import fs from "fs";
import Yaml from "yaml";

const _path = "./plugins/WeChat-Web-plugin/config";

/** 检查配置文件是否存在 */
if (!fs.existsSync(_path + "/config.yaml")) {
  fs.copyFileSync(_path + "/defSet/config.yaml", _path + "/config.yaml");
}

const cfg = Yaml.parse(fs.readFileSync(_path + "/config.yaml", "utf8"));

export { cfg };
