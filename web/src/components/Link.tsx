import type { AnchorHTMLAttributes } from "react";
import { Link as RouterLink } from "@tanstack/react-router";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string };

export function Link({ href, ...props }: LinkProps) {
  return <RouterLink to={href as never} {...props} />;
}
