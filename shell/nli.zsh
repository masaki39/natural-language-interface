# Load from ~/.zshrc with: eval "$(nli init zsh)"
# Type a tool and a request, then press Ctrl-X Ctrl-N (or $NLI_KEY, set before the eval):
#   gh リポジトリ一覧を取得   →   gh repo list
# The line is replaced with the suggestion and nothing runs until you press Enter.
nli-widget() {
  local line=${BUFFER#nli }
  local tool=${line%% *} request=${line#* }
  if [[ -z $tool || $request == $line ]]; then
    zle -M "nli: type a tool and a request first, e.g. gh リポジトリ一覧"
    return
  fi
  zle -M "nli: thinking..."
  zle -R
  local suggestion err=${TMPDIR:-/tmp}/nli-widget.$$
  if suggestion=$(nli "$tool" "$request" --pick </dev/tty 2>$err); then
    BUFFER=$suggestion
    CURSOR=${#BUFFER}
    zle -M ""
  else
    zle -M "$(tail -n 1 $err)"
  fi
  rm -f $err
}
zle -N nli-widget
bindkey "${NLI_KEY:-^X^N}" nli-widget
bindkey -M vicmd "${NLI_KEY:-^X^N}" nli-widget
