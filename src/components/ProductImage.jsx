import { useEffect, useState } from "react";
import { AppstoreOutlined } from "@ant-design/icons";
import { resolveApiAssetUrl } from "../services/api";

const ProductImage = ({ src, alt = "" }) => {
  const imageUrl = resolveApiAssetUrl(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [imageUrl]);

  if (!imageUrl || failed) {
    return <AppstoreOutlined aria-label="Product image unavailable" />;
  }

  return <img src={imageUrl} alt={alt} onError={() => setFailed(true)} />;
};

export default ProductImage;
