# Load from ~/.zshrc with: eval "$(nli init zsh)"
#
#   nli gh リポジトリ一覧 <Enter>   →   gh repo list      (NLI_ENTER=0 to opt out)
#   gh リポジトリ一覧 <Alt-N>        →   gh repo list      (NLI_KEY to change the key)
#
# Set NLI_KEY / NLI_ENTER before the eval.
#
# The line is replaced with the suggestion and nothing runs until you press Enter again.

# Replace "<tool> <request>" (an optional leading "nli" is dropped) with nli's suggestion.
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
    print -s -- "$BUFFER"
    BUFFER=$suggestion
    CURSOR=${#BUFFER}
    zle -M ""
  else
    zle -M "$(tail -n 1 $err)"
  fi
  rm -f $err
}
zle -N nli-widget
for keymap in emacs viins vicmd; do
  bindkey -M $keymap "${NLI_KEY:-^[n}" nli-widget
done
unset keymap

# Enter on "nli <tool> <request>" suggests instead of running. Lines with options
# (nli gh ... --explain) and nli's own commands (nli list, nli init) run as usual.
# Enter is rebound rather than accept-line redefined: dotfiles and plugins often replace or wrap
# accept-line after this runs, and `zle accept-line` below calls whatever it ends up being.
if [[ ${NLI_ENTER:-1} != 0 ]]; then
  nli-enter() {
    local -a words=(${(z)BUFFER})
    if [[ ${words[1]} == nli && ${#words} -ge 3 && ${words[2]} != (list|init) && -z ${(M)words:#-*} ]]; then
      zle nli-widget
    else
      zle accept-line
    fi
  }
  zle -N nli-enter
  for keymap in emacs viins vicmd; do
    bindkey -M $keymap '^M' nli-enter
  done
  unset keymap
fi
